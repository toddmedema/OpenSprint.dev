import fs from "fs";
import os from "os";
import path from "path";

export interface RuntimeTracePayload {
  [key: string]: unknown;
}

function defaultRuntimeLogPath(): string {
  return path.join(os.homedir(), ".opensprint", "backend-runtime.log");
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

export function appendRuntimeTrace(
  event: string,
  sessionId: string,
  payload?: RuntimeTracePayload
): void {
  const runtimeLogPath = process.env.OPENSPRINT_RUNTIME_LOG_PATH || defaultRuntimeLogPath();
  try {
    fs.mkdirSync(path.dirname(runtimeLogPath), { recursive: true });
    const line =
      safeStringify({
        ts: new Date().toISOString(),
        pid: process.pid,
        ppid: process.ppid,
        sessionId,
        event,
        payload: payload ?? {},
      }) + "\n";
    fs.appendFileSync(runtimeLogPath, line, "utf-8");
  } catch {
    // Best effort only.
  }
}
