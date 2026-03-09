/**
 * Commit message utilities for PRD §5.9 format:
 * Closed [task ID]: [task name truncated to ~45 chars]
 */

export const TITLE_MAX_LEN = 45;

/**
 * Truncate a title to ~45 characters with a Unicode ellipsis (…).
 * Prefers cutting at a word boundary; hard-cuts at 45 if no boundary found.
 */
export function truncateTitle(title: string, maxLen: number = TITLE_MAX_LEN): string {
  if (title.length <= maxLen) return title;
  const lastSpace = title.lastIndexOf(" ", maxLen);
  const cutPoint = lastSpace > 0 ? lastSpace : maxLen;
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
