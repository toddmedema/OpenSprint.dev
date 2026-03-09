# Plan: Exportable Electron Desktop Version of OpenSprint

## 1. Current Architecture Summary

- **Frontend**: React + Vite in `packages/frontend`. Dev: Vite dev server (port 5173) with proxy to backend. API base: `VITE_API_BASE` (empty = same-origin). WebSocket: `window.location.host` (same-origin).
- **Backend**: Express + WebSocket in `packages/backend` (port 3100). API-only; does not serve static frontend. On startup, after 15s without a WebSocket client, opens system browser to `http://localhost:5173`.
- **Data**: SQLite (default) or PostgreSQL via `DATABASE_URL` or `~/.opensprint/global-settings.json` → `databaseUrl`. Task store and app state are DB-backed.
- **Runtime**: `~/.opensprint` for config, PID file, agent work; project repos use `.opensprint/` for spec, plans, active work.

## 2. Goals for the Electron Build

- **Single installable app**: User downloads one artifact (e.g. `.dmg` / `.exe` / `.AppImage`) and runs OpenSprint without installing Node or running `npm run dev`.
- **Same behavior as web**: All SPEED phases, WebSockets, projects, and agent orchestration work as today.
- **Exportable**: Build produces distributable installers for macOS, Windows, and Linux (as desired).

## 3. High-Level Approach

- Add an **Electron layer** that:
  1. Starts the backend (in a child process or in-process).
  2. Serves the **pre-built frontend** from the backend when running in “desktop” mode so the app is same-origin and no CORS/WS tricks are needed.
  3. Opens an **Electron BrowserWindow** to that URL (no system browser, no `openBrowser`).
  4. On app quit, shuts down the backend and exits cleanly.
- Use **electron-builder** (or similar) to produce installers and portable binaries.

## 4. Implementation Plan

### Phase A: Backend “desktop” mode

**A.1 – Static frontend serving**

- Add a **desktop mode** flag (e.g. `OPENSPRINT_DESKTOP=1` or `process.env.OPENSPRINT_DESKTOP` set by Electron).
- When desktop mode is set, before mounting API routes, mount `express.static()` for a configurable directory (e.g. `process.env.OPENSPRINT_FRONTEND_DIST` or a path passed by Electron).
- Add a catch-all SPA fallback: `app.get("*", (req, res) => res.sendFile(path.join(frontendDist, "index.html")))` so client-side routing works. Ensure this is registered **after** `/api` and `/ws` so API and WebSocket are unchanged.
- Ensure `index.html` and assets are correct for production (Vite build output).

**A.2 – No browser auto-open in desktop mode**

- In `packages/backend/src/index.ts`, skip the “open frontend after 15s” logic when `OPENSPRINT_DESKTOP` is set (Electron will show the window instead).

**A.3 – Optional: PID file in desktop mode**

- Consider skipping PID file creation in desktop mode so multiple Electron instances don’t fight (or use a per-user/per-app PID path). Optional for v1.

### Phase B: Electron app shell

**B.1 – New package**

- Add `packages/electron` (or `apps/electron`) with its own `package.json`.
- Dependencies: `electron`, `electron-builder` (dev). Use the existing backend and frontend as workspace dependencies or reference built outputs.

**B.2 – Main process (Option 1: backend as child process)**

- **Entry**: `main.js` (or `main.ts` compiled to JS) run by Electron.
- **Start backend**: Use **Option 1 only**: `child_process.spawn` the built Node backend (`packages/backend/dist/index.js`) with:
  - Env: `OPENSPRINT_DESKTOP=1` and `OPENSPRINT_FRONTEND_DIST=<path>` (path = dev: `packages/frontend/dist`; packaged: e.g. `path.join(app.getAppPath(), 'resources', 'frontend')` or equivalent unpacked path).
  - `cwd` set to the backend package or app resources so backend can resolve relative paths and node_modules.
  - Capture or ignore backend stdout/stderr (e.g. pipe to main process for dev, or discard in prod).
- **Wait for backend ready**: Poll `http://localhost:3100/health` (or TCP connect to port 3100) until the server responds. Use a short interval (e.g. 200ms) and a max wait (e.g. 30s); if timeout, show an error in the window and exit or retry.
- **Create window**: `new BrowserWindow({ ... })` and `win.loadURL("http://localhost:3100")` so the UI is the backend-served SPA. Optionally restrict `openExternal` for links (e.g. allow docs/support, block arbitrary URLs).
- **On window close / app quit**: Kill the backend child process (e.g. `backendProcess.kill('SIGTERM')`), wait briefly for exit, then `app.quit()`.

**B.3 – Frontend build for Electron**

- Reuse the existing Vite production build: `npm run build -w packages/frontend` → `packages/frontend/dist`.
- In Electron builds, copy `packages/frontend/dist` into the app resources (e.g. `resources/app.asar.unpacked/frontend` or a folder next to the executable). Set `OPENSPRINT_FRONTEND_DIST` to that path when starting the backend.

**B.4 – Packaged backend**

- Backend must run from **built** JS: `packages/backend/dist` (and any runtime deps). Either:
  - Bundle backend into the Electron app (e.g. copy `dist` + `node_modules` or use a bundler like `esbuild` for the backend into a single file), or
  - Ship the backend as separate files and run with `node path/to/index.js`; ensure `node_modules` for the backend are available in the packaged app (electron-builder can include them or use a single bundled file).

### Phase C: Packaging and distribution

**C.1 – electron-builder config**

- In `packages/electron`, add `electron-builder.json` (or section in `package.json`):
  - **appId**: e.g. `com.opensprint.app`.
  - **files**: Include main process, backend dist (or bundled backend), frontend dist, and necessary node_modules.
  - **extraResources** (optional): If backend runs as a separate Node script, include Node runtime or point to system Node; or bundle backend so only Electron binary is needed.
- **Targets**: `dmg` (macOS), `nsis` or `portable` (Windows), `AppImage` or `snap` (Linux).

**C.2 – Build pipeline**

- Script (e.g. `npm run build:desktop` at repo root):
  1. `npm run build` (shared, backend, frontend).
  2. Copy or reference `packages/frontend/dist` and `packages/backend/dist` into `packages/electron` (or a staging dir).
  3. Run `electron-builder` from `packages/electron` (e.g. `npx electron-builder --dir` for unpacked, `--mac` / `--win` / `--linux` for installers).

**C.3 – Database and runtime paths**

- Backend uses `~/.opensprint` and `process.env.DATABASE_URL` / global-settings. Default is SQLite (`~/.opensprint/data/opensprint.sqlite`), so the desktop app runs with zero database setup. Users can upgrade to PostgreSQL via Settings.

### Phase D: Polish and docs

**D.1 – Single instance (required)**

- Use `app.requestSingleInstanceLock()`. If the lock is not acquired, call `app.quit()` and exit.
- On `second-instance`, focus and restore the existing window (e.g. `win.show()`, `win.focus()`). This ensures only one OpenSprint desktop instance runs; relaunching focuses the existing window.

**D.2 – Menu / dev tools**

- In development, open DevTools. In production, hide or gate behind a shortcut.

**D.3 – Documentation**

- Add a short “Desktop build” section to the main README: how to build installers, and where `~/.opensprint` lives (SQLite default, PostgreSQL optional).

## 5. Actionable Tasks for Implementation

Implement in this order. Each task is self-contained so the next agent can execute them sequentially.

### Backend (Phase A)

| # | Task | Location | Details |
|---|------|----------|---------|
| 1 | Add desktop mode static serving | `packages/backend/src/app.ts` | If `process.env.OPENSPRINT_DESKTOP === '1'` and `process.env.OPENSPRINT_FRONTEND_DIST` is set: (1) Mount `express.static(OPENSPRINT_FRONTEND_DIST)` before API routes. (2) Add a catch-all GET `*` route that sends `path.join(frontendDist, 'index.html')`. Register the catch-all **after** all API/health/ws routes so `/api` and `/ws` are untouched. |
| 2 | Skip browser auto-open in desktop mode | `packages/backend/src/index.ts` | In the `setTimeout(..., 15_000)` block that calls `openBrowser(url)`, wrap the body in `if (process.env.OPENSPRINT_DESKTOP !== '1') { ... }` so the browser is never opened when running under Electron. |

### Electron package (Phase B + D.1)

| # | Task | Location | Details |
|---|------|----------|---------|
| 3 | Create Electron package | New: `packages/electron/` | Add `packages/electron/package.json` with `"main": "main.js"`, dependencies `electron`, devDependencies `electron-builder`. Add workspace to root `package.json` workspaces array if not using a monorepo workspace pattern that auto-includes `packages/*`. |
| 4 | Implement main process | `packages/electron/main.js` (or `main.ts` → build to `main.js`) | (1) Call `app.requestSingleInstanceLock()`; if it returns false, call `app.quit()` and exit. (2) On `app.on('second-instance', ...)`, focus/show existing BrowserWindow and return. (3) Spawn backend: `child_process.spawn('node', ['dist/index.js'], { env: { ...process.env, OPENSPRINT_DESKTOP: '1', OPENSPRINT_FRONTEND_DIST: frontendDistPath }, cwd: backendDir })`. Resolve `frontendDistPath` and `backendDir` for both dev (paths to `packages/frontend/dist` and `packages/backend`) and packaged app. (4) Poll `http://localhost:3100/health` until 200 or timeout (~30s). (5) Create `BrowserWindow`, load `http://localhost:3100`. (6) On `app.on('before-quit')` or window closed (if last window), kill the backend child process with SIGTERM, then quit. |
| 5 | Resolve paths for dev vs packaged | `packages/electron/main.js` | Use `app.isPackaged` (or similar) to set `backendDir` and `frontendDistPath`: when not packaged, use `path.join(__dirname, '..', 'backend')` and `path.join(__dirname, '..', 'frontend', 'dist')` (relative to electron package). When packaged, use paths from `process.resourcesPath` or `app.getAppPath()` per electron-builder layout (e.g. `extraResources` or `asarUnpack`). |
| 6 | Wire backend process stdio (optional) | `packages/electron/main.js` | In dev, pipe backend stdout/stderr to the terminal or a log file for debugging. In production, can ignore or log to a file in user data dir. |

### Packaging (Phase C)

| # | Task | Location | Details |
|---|------|----------|---------|
| 7 | electron-builder config | `packages/electron/package.json` or `packages/electron/electron-builder.json` | Set `build.appId` (e.g. `com.opensprint.app`), `build.files` to include main process and (if not in extraResources) backend dist + frontend dist. Use `extraResources` or `asarUnpack` to ship backend `dist/`, backend `node_modules` (or a single bundled backend file), and frontend `dist/` so the main process can pass correct paths to the spawned Node process. Ensure the Node executable is available (system `node` or ship a Node binary in resources). |
| 8 | Root build script | Root `package.json` | Add script `build:desktop`: (1) Run `npm run build` (shared, backend, frontend). (2) Run electron-builder from `packages/electron` (e.g. `npm run build -w packages/electron` or `cd packages/electron && npx electron-builder`). In `packages/electron`, add a `build` script that runs `electron-builder` with the desired targets (e.g. `--mac`, `--win`, `--linux` or `--dir` for unpacked). |
| 9 | Dev run script | Root and/or `packages/electron` | Add `start:desktop` (or `electron .` from `packages/electron`): ensure frontend and backend are built once, then run Electron with NODE_ENV or ENV so path resolution uses dev paths (e.g. `packages/frontend/dist` and `packages/backend`). |

### Polish and docs (Phase D.2–D.3)

| # | Task | Location | Details |
|---|------|----------|---------|
| 10 | DevTools in dev only | `packages/electron/main.js` | When creating the BrowserWindow, if not `app.isPackaged` (or a dev flag), call `win.webContents.openDevTools()`. In production, do not open DevTools by default (optional: open on a shortcut). |
| 11 | README desktop section | Root `README.md` | Add a "Desktop build" or "Building the desktop app" section: (1) Prereqs: Node, npm. (2) Commands: `npm run build:desktop` (and optionally `npm run start:desktop` for development). (3) Output: where installers or unpacked app are written. (4) Note that OpenSprint Desktop uses `~/.opensprint` for config and data (SQLite by default). |

### Verification checklist

- [ ] Backend serves frontend at `http://localhost:3100` when `OPENSPRINT_DESKTOP=1` and `OPENSPRINT_FRONTEND_DIST` are set; `/api` and `/ws` still work.
- [ ] Backend does not open system browser when `OPENSPRINT_DESKTOP=1`.
- [ ] Electron app starts backend, waits for health, opens window to `http://localhost:3100`; UI loads and WebSocket connects.
- [ ] Second launch focuses existing window (single instance).
- [ ] On quit, backend process exits and Electron exits cleanly.
- [ ] `npm run build:desktop` produces an installer or unpacked app that runs the same way.

---

## 6. Directory and Script Summary

Suggested layout:

```
packages/
  electron/
    package.json
    electron-builder.json (or in package.json "build")
    main.js (or main.ts → main.js)
    (optional: preload.js if you need contextBridge)
  frontend/   (unchanged; build output used by backend in desktop mode)
  backend/    (add desktop-mode static serving + skip openBrowser)
  shared/     (unchanged)
```

Root scripts:

- `build:desktop`: build shared + backend + frontend, then run electron-builder.
- Optionally `start:desktop`: run Electron in development (point `OPENSPRINT_FRONTEND_DIST` to `packages/frontend/dist` after a one-time build).

## 7. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Backend or frontend path wrong in packaged app | Use `app.getAppPath()` and known relative paths; test packaged build on each OS. |
| PostgreSQL not installed | SQLite is default; no action needed. Document optional Postgres upgrade in Settings. |
| Antivirus or Gatekeeper flags the app | Sign the app (macOS: Apple Developer ID; Windows: code signing cert); notarize on macOS. |
| Large installer size | Exclude devDependencies in packaged backend; consider bundling backend to reduce node_modules. |

## 8. Out of Scope (Later)

- (Done: SQLite is default; PostgreSQL optional.)
- Auto-updates (electron-updater).
- System tray or background operation without a window.

---

**Summary**: Add a small Electron package that spawns the existing backend as a child process (Option 1) in “desktop” mode (serving the built frontend and not opening the browser), opens a single window to that URL, and quits the backend on exit. Enforce a single instance via requestSingleInstanceLock() and focus the existing window on second launch. Use electron-builder to produce installers. DB defaults to SQLite; PostgreSQL is optional.
