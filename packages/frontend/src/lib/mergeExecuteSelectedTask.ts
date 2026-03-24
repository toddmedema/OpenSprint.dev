import type { Task } from "@opensprint/shared";

/**
 * Execute task detail uses React Query (`useTaskDetail`) as the primary source, with Redux
 * (`selectTaskById`) for optimistic priority. Merge-gate and column state are updated live via
 * WebSocket into Redux first; overlay those fields so the sidebar matches the kanban without
 * waiting for a detail refetch.
 */
export function mergeExecuteSelectedTaskData(fromDetail: Task | null, fromStore: Task | null): Task | null {
  const base = fromDetail ?? fromStore ?? null;
  if (!base) return null;
  if (!fromStore || !fromDetail || fromDetail.id !== fromStore.id) return base;
  return {
    ...base,
    priority: fromStore.priority,
    kanbanColumn: fromStore.kanbanColumn,
    mergePausedUntil: fromStore.mergePausedUntil,
    mergeWaitingOnMain: fromStore.mergeWaitingOnMain,
    mergeGateState: fromStore.mergeGateState,
  };
}
