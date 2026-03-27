import fs from "fs";
import os from "os";
import path from "path";

function defaultCrashLogPath(): string {
  return path.join(os.homedir(), ".opensprint", "backend-crash.log");
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

export function appendCrashLog(event: string, payload?: Record<string, unknown>): void {
  const crashLogPath = process.env.OPENSPRINT_CRASH_LOG_PATH || defaultCrashLogPath();
  try {
    fs.mkdirSync(path.dirname(crashLogPath), { recursive: true });
    const line =
      safeStringify({
        ts: new Date().toISOString(),
        pid: process.pid,
        event,
        payload: payload ?? {},
      }) + "\n";
    fs.appendFileSync(crashLogPath, line, "utf-8");
  } catch {
    // Best effort only: never throw while handling a crash path.
  }
}
