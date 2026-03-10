import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import http from "http";
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  session,
  shell,
  dialog,
  globalShortcut,
  ipcMain,
  type MenuItemConstructorOptions,
} from "electron";

const APP_NAME = "Open Sprint";
const BACKEND_PORT = 3100;
const HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/health`;
const HEALTH_POLL_MS = 200;
const HEALTH_TIMEOUT_MS = 30000;
const BACKEND_FORCE_KILL_MS = 5000;
const API_BASE = `http://127.0.0.1:${BACKEND_PORT}/api/v1`;
const TRAY_REFRESH_MS = 10000;

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let backendShutdownPromise: Promise<void> | null = null;
let tray: Tray | null = null;
let trayRefreshInterval: ReturnType<typeof setInterval> | null = null;
let isQuitting = false;
let quitAfterBackendStop = false;

app.setName(APP_NAME);
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.log(`${APP_NAME} is already running`);
  app.exit(0);
}

function getPaths(): {
  backendDir: string;
  backendEntry: string;
  frontendDist: string;
} {
  const isPackaged = app.isPackaged;
  if (isPackaged) {
    const resourcesPath = process.resourcesPath;
    return {
      backendDir: path.join(resourcesPath, "backend"),
      backendEntry: path.join(resourcesPath, "backend", "dist", "index.js"),
      frontendDist: path.join(resourcesPath, "frontend"),
    };
  }
  // When running from dist/main.js, __dirname is packages/electron/dist
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  return {
    backendDir: path.join(repoRoot, "packages", "backend"),
    backendEntry: path.join(repoRoot, "packages", "backend", "dist", "index.js"),
    frontendDist: path.join(repoRoot, "packages", "frontend", "dist"),
  };
}

function getAppIconPath(): string | null {
  const isPackaged = app.isPackaged;
  const frontendDir = isPackaged
    ? path.join(process.resourcesPath, "frontend")
    : path.join(__dirname, "..", "desktop-resources", "frontend");
  const candidates =
    process.platform === "darwin"
      ? [
          "desktop-icon-mac.png",
          "logo-512x512.png",
          "logo-192x192.png",
          "apple-touch-icon.png",
          "favicon.ico",
        ]
      : ["logo-512x512.png", "logo-192x192.png", "apple-touch-icon.png", "favicon.ico"];
  for (const file of candidates) {
    const fullPath = path.join(frontendDir, file);
    if (fs.existsSync(fullPath)) return fullPath;
  }
  return null;
}

function applyRuntimeBranding(): string | null {
  const iconPath = getAppIconPath();
  if (!iconPath) return null;
  const iconImage = nativeImage.createFromPath(iconPath);
  if (iconImage.isEmpty()) return null;
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(iconImage);
  }
  return iconPath;
}

function getTrayIconPaths(): {
  normalPath: string;
  withDotPath: string;
  isTemplate: boolean;
} {
  const isPackaged = app.isPackaged;
  const frontendDir = isPackaged
    ? path.join(process.resourcesPath, "frontend")
    : path.join(__dirname, "..", "desktop-resources", "frontend");
  const normal =
    process.platform === "darwin"
      ? path.join(frontendDir, "trayIconTemplate.png")
      : path.join(frontendDir, "favicon-16x16.png");
  const dotPath = path.join(frontendDir, "trayIconTemplateDot.png");
  const normalPath = fs.existsSync(normal) ? normal : path.join(frontendDir, "favicon-16x16.png");
  const withDotPath = fs.existsSync(dotPath) ? dotPath : normalPath;
  return { normalPath, withDotPath, isTemplate: process.platform === "darwin" };
}

function fetchJson(url: string, timeoutMs = 500): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data) as Record<string, unknown>);
        } catch {
          reject(new Error("Invalid JSON"));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

function waitForBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function poll(): void {
      const req = http.get(HEALTH_URL, (res) => {
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        tryNext();
      });
      req.on("error", tryNext);
      req.setTimeout(5000, () => {
        req.destroy();
        tryNext();
      });
    }
    function tryNext(): void {
      if (Date.now() - start >= HEALTH_TIMEOUT_MS) {
        reject(new Error("Backend failed to start within 30s"));
        return;
      }
      setTimeout(poll, HEALTH_POLL_MS);
    }
    poll();
  });
}

function startBackend(): ChildProcess {
  const { backendDir, backendEntry, frontendDist } = getPaths();
  const env = {
    ...process.env,
    OPENSPRINT_DESKTOP: "1",
    OPENSPRINT_FRONTEND_DIST: frontendDist,
  };
  const child = spawn("node", [backendEntry], {
    cwd: backendDir,
    env,
    stdio: app.isPackaged ? "ignore" : ["inherit", "pipe", "pipe"],
  });
  if (!app.isPackaged && child.stdout) {
    child.stdout.on("data", (data: Buffer) => process.stdout.write(data));
  }
  if (!app.isPackaged && child.stderr) {
    child.stderr.on("data", (data: Buffer) => process.stderr.write(data));
  }
  child.on("error", (err: Error) => {
    console.error("Backend process error:", err);
  });
  child.on("exit", (code, signal) => {
    if (backendProcess === child) {
      backendProcess = null;
      backendShutdownPromise = null;
    }
    if (isQuitting) return;
    if (code != null && code !== 0) {
      console.error("Backend exited with code", code);
      dialog.showErrorBox(
        "Backend Error",
        "The backend process crashed. The app will now quit."
      );
      app.exit(1);
    }
    if (signal) {
      console.error("Backend killed with signal", signal);
    }
  });
  return child;
}

function createWindow(): void {
  const appIconPath = getAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: APP_NAME,
    icon: appIconPath || undefined,
    show: false,
    backgroundColor: "#0f172a",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });
  mainWindow.webContents.on(
    "found-in-page",
    (
      _e: Electron.Event,
      result: { requestId: number; activeMatchOrdinal: number; matches: number; finalUpdate: boolean }
    ) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("find-result", result);
      }
    }
  );
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== `http://127.0.0.1:${BACKEND_PORT}`) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });
  mainWindow.loadURL(`http://127.0.0.1:${BACKEND_PORT}`);
  mainWindow.on("close", (e) => {
    if (isQuitting) {
      return;
    }
    e.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

function refreshTrayMenu(): Promise<void> {
  if (!tray || tray.isDestroyed()) return Promise.resolve();
  const { normalPath, withDotPath, isTemplate } = getTrayIconPaths();
  return Promise.all([
    fetchJson(`${API_BASE}/agents/active-count`).catch(() => ({ data: { count: 0 } })),
    fetchJson(`${API_BASE}/notifications/pending-count`).catch(() => ({ data: { count: 0 } })),
    fetchJson(`${API_BASE}/global-settings`).catch(() => ({
      data: { showNotificationDotInMenuBar: true },
    })),
  ]).then(([agentsRes, notifRes, settingsRes]) => {
    if (!tray || tray.isDestroyed()) return;
    const agentCount = (agentsRes?.data as { count?: number } | undefined)?.count ?? 0;
    const pendingCount = (notifRes?.data as { count?: number } | undefined)?.count ?? 0;
    const showDot =
      (settingsRes?.data as { showNotificationDotInMenuBar?: boolean } | undefined)
        ?.showNotificationDotInMenuBar !== false;
    const useDotIcon = pendingCount > 0 && showDot;
    const iconPath = useDotIcon ? withDotPath : normalPath;
    let img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) img = nativeImage.createFromPath(normalPath);
    if (isTemplate && !img.isEmpty()) img.setTemplateImage(true);
    tray.setImage(img);
    if (process.platform === "darwin") {
      const showCount =
        (settingsRes?.data as { showRunningAgentCountInMenuBar?: boolean } | undefined)
          ?.showRunningAgentCountInMenuBar !== false;
      const title = showCount
        ? agentCount === 0
          ? ""
          : agentCount > 9
            ? "9+"
            : String(agentCount)
        : "";
      tray.setTitle(title, { fontType: "monospacedDigit" });
    }
    const menu = Menu.buildFromTemplate([
      { label: `${agentCount} agents running`, enabled: false },
      { type: "separator" },
      {
        label: `Show ${APP_NAME}`,
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: "separator" },
      { label: "Quit", role: "quit" },
    ]);
    tray.setContextMenu(menu);
  });
}

function createTray(): void {
  const { normalPath, isTemplate } = getTrayIconPaths();
  let img = nativeImage.createFromPath(normalPath);
  if (img.isEmpty())
    img = nativeImage.createFromPath(path.join(path.dirname(normalPath), "favicon-16x16.png"));
  if (isTemplate && !img.isEmpty()) img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip(APP_NAME);
  if (process.platform === "darwin") tray.setTitle("", { fontType: "monospacedDigit" });
  refreshTrayMenu();
  tray.on("click", () => {
    if (process.platform === "darwin") {
      refreshTrayMenu().then(() => {
        if (tray && !tray.isDestroyed()) tray.popUpContextMenu();
      });
    } else if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function focusAndOpenFindBar(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("open-find-bar");
  }
}

function setApplicationMenu(): void {
  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { label: "Find", accelerator: "CommandOrControl+F", click: focusAndOpenFindBar },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "selectAll" as const },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" as const },
        { role: "toggleDevTools" as const },
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" as const },
        { role: "zoom" as const },
        ...(process.platform === "darwin"
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }]),
      ],
    },
  ] as MenuItemConstructorOptions[];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function isProcessAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killBackend(): Promise<void> {
  if (!backendProcess) return Promise.resolve();
  if (backendShutdownPromise) return backendShutdownPromise;

  const proc = backendProcess;
  const pid = proc.pid;
  backendShutdownPromise = new Promise((resolve) => {
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (backendProcess === proc) {
        backendProcess = null;
      }
      backendShutdownPromise = null;
      resolve();
    };

    if (
      !pid ||
      proc.exitCode !== null ||
      proc.signalCode !== null ||
      !isProcessAlive(pid)
    ) {
      finish();
      return;
    }

    const onExit = () => {
      finish();
    };
    proc.once("exit", onExit);

    try {
      proc.kill("SIGTERM");
    } catch {
      finish();
      return;
    }

    forceKillTimer = setTimeout(() => {
      if (isProcessAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // ignore
        }
      }
      if (!isProcessAlive(pid)) {
        proc.removeListener("exit", onExit);
        finish();
      }
    }, BACKEND_FORCE_KILL_MS);
  });

  return backendShutdownPromise;
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function setupSessionSecurity(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ["clipboard-read", "clipboard-sanitized-write"];
    callback(allowed.includes(permission));
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const backendOrigin = `http://127.0.0.1:${BACKEND_PORT}`;
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self' " +
            backendOrigin +
            "; script-src 'self'; connect-src 'self' ws://127.0.0.1:" +
            BACKEND_PORT +
            "; style-src 'self' 'unsafe-inline'; img-src 'self' data: " +
            backendOrigin,
        ],
      },
    });
  });
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) {
    return;
  }

  setupSessionSecurity();
  applyRuntimeBranding();
  backendProcess = startBackend();
  try {
    await waitForBackend();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    await killBackend();
    dialog.showErrorBox(
      "Backend Failed to Start",
      `The backend could not start: ${message}. Check that port ${BACKEND_PORT} is not in use.`
    );
    app.exit(1);
    return;
  }
  createWindow();
  setApplicationMenu();
  createTray();
  trayRefreshInterval = setInterval(refreshTrayMenu, TRAY_REFRESH_MS);

  ipcMain.handle(
    "find-in-page",
    (
      event: Electron.IpcMainInvokeEvent,
      text: string,
      options?: { forward?: boolean; findNext?: boolean; caseSensitive?: boolean }
    ) => {
      const wc = event.sender;
      if (wc && !wc.isDestroyed()) wc.findInPage(text, options ?? {});
    }
  );
  ipcMain.handle(
    "stop-find-in-page",
    (event: Electron.IpcMainInvokeEvent, action: "clearSelection" | "keepSelection" | "activateSelection") => {
      const wc = event.sender;
      if (wc && !wc.isDestroyed()) wc.stopFindInPage(action);
    }
  );

  globalShortcut.register("CommandOrControl+F", focusAndOpenFindBar);
});

app.on("activate", () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  if (trayRefreshInterval) {
    clearInterval(trayRefreshInterval);
    trayRefreshInterval = null;
  }

  if (quitAfterBackendStop) return;
  if (!backendProcess) return;

  event.preventDefault();
  quitAfterBackendStop = true;
  void killBackend().finally(() => {
    app.quit();
  });
});
