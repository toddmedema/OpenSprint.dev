import type { Plan, PlanDependencyEdge, PlanExecuteBatchStatus } from "@opensprint/shared";
import { api } from "../../../api/client";
import { formatPlanIdAsTitle } from "../../../lib/formatting";
import { parsePlanContent } from "../../../lib/planContentUtils";
import type { PlanDetailPlanTasksHint } from "../../../components/plan/PlanDetailContent";

export async function pollPlanExecuteBatchUntilDone(
  projectId: string,
  batchId: string
): Promise<PlanExecuteBatchStatus> {
  for (;;) {
    const s = await api.plans.getExecuteBatchStatus(projectId, batchId);
    if (s.status !== "running") return s;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Display text for plan chat: show "Plan updated" when agent response contains [PLAN_UPDATE] */
export function getPlanChatMessageDisplay(content: string): string {
  return /\[PLAN_UPDATE\]/.test(content) ? "Plan updated" : content;
}

export function hasGeneratedPlanTasksForCurrentVersion(plan: Plan): boolean {
  return plan.hasGeneratedPlanTasksForCurrentVersion === true;
}

/**
 * Sidebar / detail hints for Plan Tasks CTAs and empty states.
 * Keeps {@link PlanTreeView} and sidebar copy aligned (e.g. no prominent Generate on nodes that already have sub-plans).
 */
export function computePlanDetailPlanTasksHint(
  selectedPlan: Plan,
  plans: Plan[],
  dependencyEdges: readonly PlanDependencyEdge[] | undefined
): PlanDetailPlanTasksHint | null {
  const pid = selectedPlan.metadata.planId;
  const childIds = selectedPlan.childPlanIds ?? [];
  const hasChildren = childIds.length > 0;

  const allChildrenHaveTasks =
    hasChildren &&
    childIds.every((id) => {
      const c = plans.find((p) => p.metadata.planId === id);
      return (
        c != null &&
        (c.hasGeneratedPlanTasksForCurrentVersion === true || (c.taskCount ?? 0) > 0)
      );
    });

  const blockerSummaries =
    dependencyEdges
      ?.filter((e) => e.to === pid && e.type === "blocks")
      .map((e) => e.from)
      .map((id) => {
        const p = plans.find((x) => x.metadata.planId === id);
        if (!p || p.status === "complete") return null;
        const { title } = parsePlanContent(p.content ?? "");
        return {
          planId: id,
          title: title.trim() || formatPlanIdAsTitle(id),
        };
      })
      .filter((x): x is { planId: string; title: string } => x != null) ?? [];

  const isChild = !!(selectedPlan.metadata.parentPlanId ?? selectedPlan.parentPlanId);

  const hint: PlanDetailPlanTasksHint = {};

  if (
    selectedPlan.tooLargeForLeaf === true ||
    (selectedPlan.failedPlanIds?.includes(pid) ?? false)
  ) {
    hint.showTooLarge = true;
  }
  if (
    blockerSummaries.length > 0 &&
    selectedPlan.status === "planning" &&
    !hasGeneratedPlanTasksForCurrentVersion(selectedPlan)
  ) {
    hint.blockedBy = blockerSummaries;
  }
  if (
    hasChildren &&
    selectedPlan.status === "planning" &&
    !hasGeneratedPlanTasksForCurrentVersion(selectedPlan) &&
    !allChildrenHaveTasks
  ) {
    hint.showParentDelegateSubplans = true;
  }
  if (hasChildren && allChildrenHaveTasks) {
    hint.showAllSubplansHaveTasks = true;
  }
  if (
    isChild &&
    !hasChildren &&
    selectedPlan.status === "planning" &&
    selectedPlan.taskCount === 0 &&
    !hasGeneratedPlanTasksForCurrentVersion(selectedPlan)
  ) {
    hint.showProminentGenerateTasks = true;
  }

  const hasAny =
    hint.showTooLarge ||
    (hint.blockedBy?.length ?? 0) > 0 ||
    hint.showParentDelegateSubplans ||
    hint.showAllSubplansHaveTasks ||
    hint.showProminentGenerateTasks;

  return hasAny ? hint : null;
}

/** Topological order for plan IDs: prerequisites first. Edge (from, to) means "from blocks to". */
export function topologicalPlanOrder(
  planIds: string[],
  edges: { from: string; to: string }[]
): string[] {
  const idSet = new Set(planIds);
  const outgoing = new Map<string, string[]>();
  for (const id of planIds) outgoing.set(id, []);
  for (const e of edges) {
    if (idSet.has(e.from) && idSet.has(e.to)) {
      outgoing.get(e.from)!.push(e.to);
    }
  }
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const to of outgoing.get(id) ?? []) visit(to);
    order.push(id);
  };
  for (const id of planIds) visit(id);
  order.reverse();
  return order;
}
