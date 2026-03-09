import { COMMIT_MESSAGE_TITLE_MAX_LENGTH } from "@opensprint/shared";
import { useAppSelector } from "../store";
import { selectTaskTitle } from "../store/slices/executeSlice";

function truncateTitle(title: string, maxLen: number = COMMIT_MESSAGE_TITLE_MAX_LENGTH): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen) + "…";
}

export interface TaskLinkDisplayProps {
  projectId: string;
  taskId: string;
  /** If provided, used immediately. From parent (e.g. taskSummaries) or Execute; avoids extra API calls. */
  cachedTitle?: string | null;
}

/**
 * Displays a task's title truncated to 45 characters for use as link text.
 * Uses execute.tasks (titleFromStore) or cachedTitle when available; otherwise shows taskId.
 * Does not fetch task detail (avoids N requests for stale IDs from feedback/plan and wrong-ID sidebar errors).
 */
export function TaskLinkDisplay({
  projectId: _projectId,
  taskId,
  cachedTitle,
}: TaskLinkDisplayProps) {
  const titleFromStore = useAppSelector((state) => selectTaskTitle(state, taskId));
  const effectiveTitle = titleFromStore ?? cachedTitle ?? null;
  const displayText = effectiveTitle != null ? truncateTitle(effectiveTitle) : taskId;
  return <>{displayText}</>;
}
