import { spawn } from "child_process";
import { appendRuntimeTrace } from "./runtime-trace.js";

/**
 * Launch a detached watcher process that survives backend termination and writes
 * a forensic breadcrumb when the backend PID disappears unexpectedly.
 */
export function startBackendDeathSentinel(params: {
  sessionId: string;
  backendPid: number;
  parentPid: number;
}): void {
  const { sessionId, backendPid, parentPid } = params;
  const script = `
const fs = require("fs");
const os = require("os");
const path = require("path");

const backendPid = Number(process.argv[1]);
const parentPid = Number(process.argv[2]);
const sessionId = String(process.argv[3] || "unknown-session");
const startedAt = Date.now();
const logPath = process.env.OPENSPRINT_SENTINEL_LOG_PATH || path.join(os.homedir(), ".opensprint", "backend-sentinel.log");

function alive(pid) {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function write(event, payload) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(
      logPath,
      JSON.stringify({
        ts: new Date().toISOString(),
        event,
        sessionId,
        watcherPid: process.pid,
        backendPid,
        parentPid,
        payload: payload || {},
      }) + "\\n",
      "utf-8"
    );
  } catch {}
}

let checks = 0;
let lastParentAlive = alive(parentPid);

write("sentinel.start", { backendAlive: alive(backendPid), parentAlive: lastParentAlive });

const interval = setInterval(() => {
  checks += 1;
  const backendAlive = alive(backendPid);
  const parentAlive = alive(parentPid);
  if (!backendAlive) {
    write("backend.disappeared", {
      checks,
      parentAliveAtDeath: parentAlive,
      parentWasAliveLastCheck: lastParentAlive,
      monitorUptimeMs: Date.now() - startedAt,
    });
    process.exit(0);
  }
  lastParentAlive = parentAlive;
}, 1000);
interval.unref();

setTimeout(() => {
  write("sentinel.timeout", {
    checks,
    backendAlive: alive(backendPid),
    parentAlive: alive(parentPid),
    monitorUptimeMs: Date.now() - startedAt,
  });
  process.exit(0);
}, 24 * 60 * 60 * 1000).unref();

process.on("uncaughtException", (err) => {
  write("sentinel.uncaughtException", {
    err: err && err.stack ? err.stack : String(err),
  });
  process.exit(1);
});
`;

  try {
    const child = spawn(process.execPath, ["-e", script, String(backendPid), String(parentPid), sessionId], {
      detached: true,
      env: {
        ...process.env,
        // Backend clears this globally so other child processes run normally.
        // Re-enable it only for this helper so Electron's embedded runtime behaves like Node.
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: "ignore",
    });
    child.unref();
    appendRuntimeTrace("process.sentinel_started", sessionId, {
      watcherPid: child.pid ?? null,
      backendPid,
      parentPid,
    });
  } catch (err) {
    appendRuntimeTrace("process.sentinel_failed", sessionId, {
      backendPid,
      parentPid,
      err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
    });
  }
}
