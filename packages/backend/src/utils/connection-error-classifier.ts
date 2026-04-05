/** True when the error indicates a local OpenAI-compatible server is unreachable. */
export function isLocalOpenAIProviderConnectionError(error: unknown, msg: string): boolean {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ECONNRESET") {
      return true;
    }
  }
  const lower = msg.toLowerCase();
  return (
    lower.includes("econnrefused") ||
    lower.includes("fetch failed") ||
    lower.includes("enotfound") ||
    lower.includes("connection error") ||
    lower.includes("socket hang up") ||
    lower.includes("network error")
  );
}
