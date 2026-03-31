/**
 * Structured logging utility for the backend.
 * Provides consistent [namespace] prefixes and optional context objects.
 * LOG_LEVEL env var controls verbosity: debug | info | warn | error.
 * Default is info in app runtime, error in Vitest to reduce test I/O noise.
 *
 * Output format: `TIMESTAMP LEVEL [namespace] message {context}`
 * Set LOG_FORMAT=json for machine-readable JSON lines output.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
};

function isVitestRuntime(): boolean {
  return Boolean(
    process.env.VITEST ||
    process.env.VITEST_WORKER_ID ||
    process.env.VITEST_POOL_ID ||
    process.env.NODE_ENV === "test" ||
    process.env.TEST === "true"
  );
}

function getLogLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw) {
    if (raw in LEVEL_ORDER) return raw as LogLevel;
    return "info";
  }
  if (isVitestRuntime()) return "error";
  return "info";
}

let cachedLevel: LogLevel | null = null;

/** Reset cached log level (for tests). */
export function resetLogLevelCache(): void {
  cachedLevel = null;
}

function shouldLog(level: LogLevel): boolean {
  if (cachedLevel === null) cachedLevel = getLogLevel();
  return LEVEL_ORDER[level] >= LEVEL_ORDER[cachedLevel];
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, currentValue: unknown) => {
    if (typeof currentValue === "bigint") {
      return `${currentValue.toString()}n`;
    }
    if (typeof currentValue === "object" && currentValue !== null) {
      if (seen.has(currentValue)) {
        return "[Circular]";
      }
      seen.add(currentValue);
    }
    return currentValue;
  });
}

let _sessionId: string | undefined;

/** Set a process-wide session/correlation ID included in every log line. */
export function setLogSessionId(id: string): void {
  _sessionId = id;
}

function isJsonFormat(): boolean {
  return process.env.LOG_FORMAT?.toLowerCase() === "json";
}

function formatMessage(
  level: LogLevel,
  namespace: string,
  msg: string,
  ctx?: Record<string, unknown>
): string {
  const ts = new Date().toISOString();

  if (isJsonFormat()) {
    const payload: Record<string, unknown> = {
      ts,
      level: level.toUpperCase(),
      ns: namespace,
      msg,
      ...(_sessionId ? { sessionId: _sessionId } : {}),
      ...(ctx && Object.keys(ctx).length > 0 ? ctx : {}),
    };
    try {
      return safeJsonStringify(payload);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return `{"ts":"${ts}","level":"${level.toUpperCase()}","ns":"${namespace}","msg":"${msg}","_logContextSerializationError":"${reason}"}`;
    }
  }

  const sessionTag = _sessionId ? ` sid=${_sessionId}` : "";
  const prefix = `${ts} ${LEVEL_LABELS[level]}${sessionTag} [${namespace}] ${msg}`;
  if (ctx && Object.keys(ctx).length > 0) {
    try {
      return `${prefix} ${safeJsonStringify(ctx)}`;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return `${prefix} {"_logContextSerializationError":"${reason}"}`;
    }
  }
  return prefix;
}

export interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  debug(msg: string, ctx?: Record<string, unknown>): void;
}

/**
 * Create a namespaced logger. All messages are prefixed with [namespace].
 * Context objects are appended as JSON when provided.
 */
export function createLogger(namespace: string): Logger {
  return {
    info(msg: string, ctx?: Record<string, unknown>): void {
      if (shouldLog("info")) {
        console.log(formatMessage("info", namespace, msg, ctx));
      }
    },
    warn(msg: string, ctx?: Record<string, unknown>): void {
      if (shouldLog("warn")) {
        console.warn(formatMessage("warn", namespace, msg, ctx));
      }
    },
    error(msg: string, ctx?: Record<string, unknown>): void {
      if (shouldLog("error")) {
        console.error(formatMessage("error", namespace, msg, ctx));
      }
    },
    debug(msg: string, ctx?: Record<string, unknown>): void {
      if (shouldLog("debug")) {
        console.log(formatMessage("debug", namespace, msg, ctx));
      }
    },
  };
}
