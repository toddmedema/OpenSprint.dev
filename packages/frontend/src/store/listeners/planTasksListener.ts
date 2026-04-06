import { createListenerMiddleware, isFulfilled } from "@reduxjs/toolkit";
import type { Plan } from "@opensprint/shared";
import {
  planTasks,
  planTasksForSubtree,
  generateTasksForPlan,
  executePlan,
  reExecutePlan,
} from "../slices/planSlice";
import { fetchTasks, fetchExecuteStatus } from "../slices/executeSlice";
import { getQueryClient } from "../../queryClient";
import { queryKeys } from "../../api/queryKeys";
import { addNotification } from "../slices/notificationSlice";
import { formatPlanIdAsTitle } from "../../lib/formatting";

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

/** True when plan-tasks created or touched sub-plans (needs list + hierarchy refetch). */
export function planTasksAffectedMultiplePlans(plan: Plan): boolean {
  if ((plan.childPlanIds?.length ?? 0) > 0) return true;
  const rootId = plan.metadata.planId;
  if ((plan.failedPlanIds?.length ?? 0) > 0) return true;
  return (plan.successPlanIds ?? []).some((id) => id !== rootId);
}

function emitSubtreePlanTasksToasts(
  dispatch: (action: unknown) => unknown,
  plan: Plan
): void {
  const rootId = plan.metadata.planId;
  const successIds = plan.successPlanIds ?? [];
  const failedIds = plan.failedPlanIds ?? [];
  const multi =
    failedIds.length > 0 || successIds.some((id) => id !== rootId);
  if (!multi) return;
  for (const id of successIds) {
    if (id === rootId) continue;
    dispatch(
      addNotification({
        message: `Plan tasks completed for ${formatPlanIdAsTitle(id)}.`,
        severity: "success",
      })
    );
  }
  for (const id of failedIds) {
    dispatch(
      addNotification({
        message: `Plan tasks failed for ${formatPlanIdAsTitle(id)}. Retry Plan Tasks on that plan.`,
        severity: "error",
      })
    );
  }
}

function afterPlanTasksSuccess(
  projectId: string,
  plan: Plan,
  listenerApi: { dispatch: (action: unknown) => unknown }
): void {
  refreshExecuteData(projectId, listenerApi);
  if (planTasksAffectedMultiplePlans(plan)) {
    void getQueryClient().invalidateQueries({ queryKey: queryKeys.plans.list(projectId) });
  }
  emitSubtreePlanTasksToasts(listenerApi.dispatch, plan);
}

planTasksListener.startListening({
  predicate: (action): action is ReturnType<typeof planTasks.fulfilled> =>
    isFulfilled(action) && planTasks.fulfilled.match(action),
  effect: (action, listenerApi) => {
    const { projectId } = action.meta.arg;
    afterPlanTasksSuccess(projectId, action.payload, listenerApi);
  },
});

planTasksListener.startListening({
  predicate: (action): action is ReturnType<typeof planTasksForSubtree.fulfilled> =>
    isFulfilled(action) && planTasksForSubtree.fulfilled.match(action),
  effect: (action, listenerApi) => {
    const { projectId } = action.meta.arg;
    afterPlanTasksSuccess(projectId, action.payload.rootPlan, listenerApi);
  },
});

planTasksListener.startListening({
  predicate: (action): action is ReturnType<typeof generateTasksForPlan.fulfilled> =>
    isFulfilled(action) && generateTasksForPlan.fulfilled.match(action),
  effect: (action, listenerApi) => {
    const { projectId } = action.meta.arg;
    afterPlanTasksSuccess(projectId, action.payload, listenerApi);
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
