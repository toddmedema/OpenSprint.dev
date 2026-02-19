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
