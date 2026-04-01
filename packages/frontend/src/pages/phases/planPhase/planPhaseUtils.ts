import type { Plan, PlanExecuteBatchStatus } from "@opensprint/shared";
import { api } from "../../../api/client";

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
