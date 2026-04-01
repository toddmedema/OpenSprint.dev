import fs from "fs";
import os from "os";
import path from "path";

const DESKTOP_CRASH_LOG_PATH = path.join(
  os.homedir(),
  ".opensprint",
  "desktop-crash.log"
);

let _sessionId = "unknown";

export function setDesktopSessionId(id: string): void {
  _sessionId = id;
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, currentValue: unknown) => {
    if (typeof currentValue === "bigint") {
      return `${currentValue.toString()}n`;
    }
    if (currentValue instanceof Error) {
      return {
        name: currentValue.name,
        message: currentValue.message,
        stack: currentValue.stack,
      };
    }
    if (typeof currentValue === "object" && currentValue !== null) {
      if (seen.has(currentValue)) return "[Circular]";
      seen.add(currentValue);
    }
    return currentValue;
  });
}

export function appendDesktopCrashLog(
  event: string,
  payload?: Record<string, unknown>
): void {
  try {
    fs.mkdirSync(path.dirname(DESKTOP_CRASH_LOG_PATH), { recursive: true });
    const line =
      safeStringify({
        ts: new Date().toISOString(),
        pid: process.pid,
        sessionId: _sessionId,
        event,
        payload: payload ?? {},
      }) + "\n";
    fs.appendFileSync(DESKTOP_CRASH_LOG_PATH, line, "utf-8");
  } catch {
    // Best effort only: never throw while handling a crash path.
  }
}
