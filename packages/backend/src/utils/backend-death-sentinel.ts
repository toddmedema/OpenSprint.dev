import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { appendRuntimeTrace } from "./runtime-trace.js";

function defaultSentinelLogPath(): string {
  return path.join(os.homedir(), ".opensprint", "backend-sentinel.log");
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

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
    const child = spawn(
      process.execPath,
      ["-e", script, String(backendPid), String(parentPid), sessionId],
      {
        detached: true,
        env: {
          ...process.env,
          // Backend clears this globally so other child processes run normally.
          // Re-enable it only for this helper so Electron's embedded runtime behaves like Node.
          ELECTRON_RUN_AS_NODE: "1",
        },
        stdio: "ignore",
      }
    );
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

/**
 * Launches a launchd-backed witness on macOS so monitoring survives parent/backend
 * process-tree teardown and can still emit forensic breadcrumbs.
 */
export function startLaunchdBackendWitness(params: {
  sessionId: string;
  backendPid: number;
  parentPid: number;
}): void {
  const { sessionId, backendPid, parentPid } = params;
  if (process.platform !== "darwin") {
    appendRuntimeTrace("process.launchd_witness_skipped", sessionId, {
      reason: "non_darwin",
      backendPid,
      parentPid,
      platform: process.platform,
    });
    return;
  }
  if (typeof process.getuid !== "function") {
    appendRuntimeTrace("process.launchd_witness_failed", sessionId, {
      reason: "missing_getuid",
      backendPid,
      parentPid,
    });
    return;
  }

  const uid = process.getuid();
  const labelSafeSession = sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24) || "unknown";
  const label = `com.opensprint.backend.witness.${labelSafeSession}.${backendPid}`;
  const witnessDir = path.join(os.homedir(), ".opensprint", "witness");
  const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const scriptPath = path.join(witnessDir, `${label}.cjs`);
  const plistPath = path.join(launchAgentsDir, `${label}.plist`);
  const outLogPath = path.join(witnessDir, `${label}.out.log`);
  const errLogPath = path.join(witnessDir, `${label}.err.log`);
  const sentinelLogPath = process.env.OPENSPRINT_SENTINEL_LOG_PATH || defaultSentinelLogPath();

  const witnessScript = [
    'const fs = require("fs");',
    'const path = require("path");',
    "",
    "const backendPid = Number(process.argv[2]);",
    "const parentPid = Number(process.argv[3]);",
    'const sessionId = String(process.argv[4] || "unknown-session");',
    'const label = String(process.argv[5] || "unknown-label");',
    'const logPath = String(process.argv[6] || "");',
    "const startedAt = Date.now();",
    "",
    "function alive(pid) {",
    "  if (!Number.isFinite(pid) || pid <= 1) return false;",
    "  try {",
    "    process.kill(pid, 0);",
    "    return true;",
    "  } catch {",
    "    return false;",
    "  }",
    "}",
    "",
    "function write(event, payload) {",
    "  try {",
    "    fs.mkdirSync(path.dirname(logPath), { recursive: true });",
    "    fs.appendFileSync(",
    "      logPath,",
    "      JSON.stringify({",
    "        ts: new Date().toISOString(),",
    "        event,",
    "        sessionId,",
    "        label,",
    "        witnessPid: process.pid,",
    "        backendPid,",
    "        parentPid,",
    "        payload: payload || {},",
    '      }) + "\\n",',
    '      "utf-8"',
    "    );",
    "  } catch {}",
    "}",
    "",
    "let checks = 0;",
    "let lastParentAlive = alive(parentPid);",
    'write("launchd_witness.start", { backendAlive: alive(backendPid), parentAlive: lastParentAlive });',
    "",
    "const interval = setInterval(() => {",
    "  checks += 1;",
    "  const backendAlive = alive(backendPid);",
    "  const parentAlive = alive(parentPid);",
    "  if (!backendAlive) {",
    '    write("launchd_witness.backend_disappeared", {',
    "      checks,",
    "      parentAliveAtDeath: parentAlive,",
    "      parentWasAliveLastCheck: lastParentAlive,",
    "      monitorUptimeMs: Date.now() - startedAt,",
    "    });",
    "    process.exit(0);",
    "  }",
    "  lastParentAlive = parentAlive;",
    "}, 1000);",
    "interval.unref();",
    "",
    "setTimeout(() => {",
    '  write("launchd_witness.timeout", {',
    "    checks,",
    "    backendAlive: alive(backendPid),",
    "    parentAlive: alive(parentPid),",
    "    monitorUptimeMs: Date.now() - startedAt,",
    "  });",
    "  process.exit(0);",
    "}, 24 * 60 * 60 * 1000).unref();",
    "",
    'process.on("uncaughtException", (err) => {',
    '  write("launchd_witness.uncaughtException", {',
    "    err: err && err.stack ? err.stack : String(err),",
    "  });",
    "  process.exit(1);",
    "});",
    "",
  ].join("\n");

  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${xmlEscape(label)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${xmlEscape(process.execPath)}</string>`,
    `    <string>${xmlEscape(scriptPath)}</string>`,
    `    <string>${backendPid}</string>`,
    `    <string>${parentPid}</string>`,
    `    <string>${xmlEscape(sessionId)}</string>`,
    `    <string>${xmlEscape(label)}</string>`,
    `    <string>${xmlEscape(sentinelLogPath)}</string>`,
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "    <key>ELECTRON_RUN_AS_NODE</key>",
    "    <string>1</string>",
    "  </dict>",
    "  <key>StandardOutPath</key>",
    `  <string>${xmlEscape(outLogPath)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xmlEscape(errLogPath)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");

  try {
    fs.mkdirSync(witnessDir, { recursive: true });
    fs.mkdirSync(launchAgentsDir, { recursive: true });
    fs.writeFileSync(scriptPath, witnessScript, { encoding: "utf-8", mode: 0o700 });
    fs.writeFileSync(plistPath, plist, "utf-8");

    const domains = [`gui/${uid}`, `user/${uid}`];
    let selectedDomain: string | null = null;
    let bootstrapDetails: { status: number | null; stderr: string; stdout: string } | null = null;

    for (const domain of domains) {
      spawnSync("launchctl", ["bootout", `${domain}/${label}`], { stdio: "ignore" });
      const bootstrap = spawnSync("launchctl", ["bootstrap", domain, plistPath], {
        encoding: "utf-8",
      });
      bootstrapDetails = {
        status: bootstrap.status,
        stderr: bootstrap.stderr ?? "",
        stdout: bootstrap.stdout ?? "",
      };
      if (bootstrap.status === 0) {
        selectedDomain = domain;
        break;
      }
    }

    if (!selectedDomain) {
      appendRuntimeTrace("process.launchd_witness_failed", sessionId, {
        reason: "bootstrap_failed",
        backendPid,
        parentPid,
        label,
        plistPath,
        bootstrap: bootstrapDetails,
      });
      return;
    }

    const kickstart = spawnSync("launchctl", ["kickstart", "-k", `${selectedDomain}/${label}`], {
      encoding: "utf-8",
    });

    appendRuntimeTrace("process.launchd_witness_started", sessionId, {
      backendPid,
      parentPid,
      label,
      domain: selectedDomain,
      plistPath,
      scriptPath,
      kickstartStatus: kickstart.status ?? null,
      kickstartStderr: kickstart.stderr ?? "",
    });
  } catch (err) {
    appendRuntimeTrace("process.launchd_witness_failed", sessionId, {
      reason: "exception",
      backendPid,
      parentPid,
      err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
    });
  }
}
