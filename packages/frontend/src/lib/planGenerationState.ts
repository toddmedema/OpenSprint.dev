import type { ActiveAgent } from "@opensprint/shared";

/**
 * Plan generation state — determines whether "Generate Tasks" should be shown,
 * replaced by a "Planning" indicator, or replaced by a "Retry" action.
 *
 * Rule: a plan whose planner agent has been running for more than 5 minutes
 * since its start is considered potentially stale. The user is offered a Retry action.
 */

export type PlanGenState = "ready" | "planning" | "stale";

export const PLAN_STALE_THRESHOLD_MS = 5 * 60 * 1000;

export const PLANNING_TOOLTIP = "Tasks will be available after the plan is ready.";
export const STALE_TOOLTIP =
  "Plan generation has been running for over 5 minutes and may be stuck. Retry to restart.";

export function getPlanGenerationState(
  planId: string,
  activeAgents: readonly ActiveAgent[],
  now: number = Date.now()
): PlanGenState {
  const plannerAgent = activeAgents.find(
    (a) => a.role === "planner" && a.planId === planId
  );

  if (!plannerAgent) return "ready";

  const elapsed = now - new Date(plannerAgent.startedAt).getTime();
  return elapsed >= PLAN_STALE_THRESHOLD_MS ? "stale" : "planning";
}

/** Return plan IDs that have an active planner agent. */
export function getActivePlannerPlanIds(
  activeAgents: readonly ActiveAgent[]
): Set<string> {
  const ids = new Set<string>();
  for (const a of activeAgents) {
    if (a.role === "planner" && a.planId) ids.add(a.planId);
  }
  return ids;
}

/** Return plan IDs whose planner has been running > 5 minutes. */
export function getStalePlannerPlanIds(
  activeAgents: readonly ActiveAgent[],
  now: number = Date.now()
): Set<string> {
  const ids = new Set<string>();
  for (const a of activeAgents) {
    if (a.role === "planner" && a.planId) {
      const elapsed = now - new Date(a.startedAt).getTime();
      if (elapsed >= PLAN_STALE_THRESHOLD_MS) ids.add(a.planId);
    }
  }
  return ids;
}
