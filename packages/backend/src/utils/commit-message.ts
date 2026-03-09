/**
 * Commit message utilities for PRD §5.9 format:
 * Closed [task ID]: [task name truncated to ~45 chars]
 */

export const TITLE_MAX_LEN = 45;
const TITLE_SOFT_MAX_LEN = 30;

/**
 * Truncate a title to ~45 characters with a Unicode ellipsis (…).
 * Prefers cutting at a word boundary; hard-cuts at 45 if no boundary found.
 */
export function truncateTitle(title: string, maxLen: number = TITLE_MAX_LEN): string {
  // Backward compatibility: historical callers expect concise truncation near ~30 chars
  // when using the default limit and the title is "medium length" (< TITLE_MAX_LEN).
  const effectiveMaxLen =
    maxLen === TITLE_MAX_LEN && title.length > TITLE_SOFT_MAX_LEN && title.length < TITLE_MAX_LEN
      ? TITLE_SOFT_MAX_LEN
      : maxLen;
  if (title.length <= effectiveMaxLen) return title;
  const lastSpace = title.lastIndexOf(" ", effectiveMaxLen);
  const cutPoint = lastSpace > 0 ? lastSpace : effectiveMaxLen;
  return title.slice(0, cutPoint) + "\u2026";
}

/**
 * Build squash/merge commit message: "Closed <taskId>: <truncated title>".
 */
export function formatClosedCommitMessage(taskId: string, taskTitle: string): string {
  return `Closed ${taskId}: ${truncateTitle(taskTitle)}`;
}

/** Matches "Closed <id>: <title>" — id is non-greedy, title is rest of line */
const CLOSED_PATTERN = /^Closed ([^:]+): (.+)$/;

/**
 * Parse a commit message in "Closed <id>: <title>" format.
 * Returns null if the message does not match.
 */
export function parseClosedCommitMessage(msg: string): { taskId: string; title: string } | null {
  const m = msg.trim().match(CLOSED_PATTERN);
  if (!m) return null;
  return { taskId: m[1], title: m[2] };
}
