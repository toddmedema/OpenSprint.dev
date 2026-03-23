import { createListenerMiddleware, isFulfilled } from "@reduxjs/toolkit";
import {
  planTasks,
  generateTasksForPlan,
  executePlan,
  reExecutePlan,
} from "../slices/planSlice";
import { fetchTasks, fetchExecuteStatus } from "../slices/executeSlice";

/**
 * When plan actions change Execute-visible task state, refresh the Execute slice immediately.
 * Child task columns can change indirectly when a plan's epic flips blocked/open, so we need
 * a fetch even though those child tasks did not receive direct `task.updated` events.
 */
export const planTasksListener = createListenerMiddleware();

function refreshExecuteData(
  projectId: string,
  listenerApi: { dispatch: (action: unknown) => unknown },
  options?: { includeExecuteStatus?: boolean }
) {
  listenerApi.dispatch(fetchTasks(projectId));
  if (options?.includeExecuteStatus) {
    listenerApi.dispatch(fetchExecuteStatus(projectId));
  }
}

planTasksListener.startListening({
  predicate: (action): action is ReturnType<typeof planTasks.fulfilled> =>
    isFulfilled(action) && planTasks.fulfilled.match(action),
  effect: (action, listenerApi) => {
    const { projectId } = action.meta.arg;
    refreshExecuteData(projectId, listenerApi);
  },
});

planTasksListener.startListening({
  predicate: (action): action is ReturnType<typeof generateTasksForPlan.fulfilled> =>
    isFulfilled(action) && generateTasksForPlan.fulfilled.match(action),
  effect: (action, listenerApi) => {
    const { projectId } = action.meta.arg;
    refreshExecuteData(projectId, listenerApi);
  },
});

planTasksListener.startListening({
  predicate: (action): action is ReturnType<typeof executePlan.fulfilled> =>
    isFulfilled(action) && executePlan.fulfilled.match(action),
  effect: (action, listenerApi) => {
    const { projectId } = action.meta.arg;
    refreshExecuteData(projectId, listenerApi, { includeExecuteStatus: true });
  },
});

planTasksListener.startListening({
  predicate: (action): action is ReturnType<typeof reExecutePlan.fulfilled> =>
    isFulfilled(action) && reExecutePlan.fulfilled.match(action),
  effect: (action, listenerApi) => {
    const { projectId } = action.meta.arg;
    refreshExecuteData(projectId, listenerApi, { includeExecuteStatus: true });
  },
});
