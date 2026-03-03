import { createListenerMiddleware, isFulfilled } from "@reduxjs/toolkit";
import { updateTaskPriority } from "../slices/executeSlice";
import { getQueryClient } from "../../queryClient";
import { queryKeys } from "../../api/queryKeys";

/**
 * When priority update succeeds:
 * - Invalidate tasks list so main content (kanban/timeline) ordering stays in sync.
 * - Update task detail cache in place (do NOT invalidate) so the sidebar does not
 *   refetch and show loading state. Only the priority component updates.
 */
export const executeListeners = createListenerMiddleware();

executeListeners.startListening({
  predicate: (action): action is ReturnType<typeof updateTaskPriority.fulfilled> =>
    isFulfilled(action) && updateTaskPriority.fulfilled.match(action),
  effect: (action) => {
    try {
      const qc = getQueryClient();
      const { task, taskId } = action.payload;
      const projectId = action.meta.arg.projectId;
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.list(projectId) });
      qc.setQueryData(queryKeys.tasks.detail(projectId, taskId), task);
    } catch {
      // QueryClient may not be set in tests
    }
  },
});
