/**
 * Extract a human-readable error message from an unknown error value.
 * @param err - The caught error (Error, string, or other)
 * @param fallback - Optional fallback when err is not an Error instance
 * @returns The error message string
 */
export function getErrorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message;
  return fallback !== undefined ? fallback : String(err);
}

/** Shape commonly seen from exec/spawn and child process errors */
export interface ExecErrorShape {
  message?: string;
  stderr?: string;
  killed?: boolean;
  signal?: string;
}

/** Type guard and accessor for exec/spawn-style errors (message, stderr, killed, signal). */
export function getExecErrorShape(err: unknown): ExecErrorShape {
  if (err == null) return {};
  if (typeof err !== "object") return { message: String(err) };
  const o = err as Record<string, unknown>;
  return {
    message: typeof o.message === "string" ? o.message : undefined,
    stderr: typeof o.stderr === "string" ? o.stderr : undefined,
    killed: typeof o.killed === "boolean" ? o.killed : undefined,
    signal: typeof o.signal === "string" ? o.signal : undefined,
  };
}
