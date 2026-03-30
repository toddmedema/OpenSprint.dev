/** Human-readable relative time for "last received" hints (testable via `nowMs`). */
export function formatRelativeReceived(iso: string, nowMs: number): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  const diffMs = Math.max(0, nowMs - parsed);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ago`;
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}
