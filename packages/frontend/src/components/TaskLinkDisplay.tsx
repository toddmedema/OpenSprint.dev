import { useState, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { api } from "../api/client";
import { mergeTask, selectTaskTitle } from "../store/slices/taskRegistrySlice";

const TITLE_MAX_LENGTH = 30;

function truncateTitle(title: string, maxLen: number = TITLE_MAX_LENGTH): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen) + "…";
}

export interface TaskLinkDisplayProps {
  projectId: string;
  taskId: string;
  /** If provided, used immediately (avoids API call). Falls back to taskId when undefined. */
  cachedTitle?: string | null;
}

/**
 * Displays a task's title truncated to 30 characters for use as link text.
 * Fetches title via API when not cached. Falls back to taskId when fetch fails.
 */
export function TaskLinkDisplay({
  projectId,
  taskId,
  cachedTitle,
}: TaskLinkDisplayProps) {
  const dispatch = useAppDispatch();
  const titleFromRegistry = useAppSelector((state) =>
    selectTaskTitle(state, projectId, taskId)
  );
  const [fetchedTitle, setFetchedTitle] = useState<string | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);

  const effectiveTitle = titleFromRegistry ?? cachedTitle ?? fetchedTitle ?? null;
  const displayText = effectiveTitle != null ? truncateTitle(effectiveTitle) : taskId;

  useEffect(() => {
    if (titleFromRegistry != null || cachedTitle != null || fetchFailed) return;
    let cancelled = false;
    api.tasks
      .get(projectId, taskId)
      .then((task) => {
        if (!cancelled) {
          setFetchedTitle(task.title ?? taskId);
          dispatch(mergeTask({ projectId, task }));
        }
      })
      .catch(() => {
        if (!cancelled) setFetchFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, taskId, titleFromRegistry, cachedTitle, fetchFailed, dispatch]);

  return <>{displayText}</>;
}
