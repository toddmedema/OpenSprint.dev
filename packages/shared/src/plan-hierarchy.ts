/**
 * Plan hierarchy utilities for depth-bounded sub-plan trees.
 */

export const MAX_PLAN_DEPTH = 4;

/**
 * Walk the parent chain to compute a plan's depth (1 = root).
 * Throws if a cycle is detected.
 */
export function calculatePlanDepth(
  planId: string,
  plansMap: Map<string, { parentPlanId?: string }>
): number {
  let depth = 1;
  const visited = new Set<string>();
  visited.add(planId);

  let current = plansMap.get(planId);
  while (current?.parentPlanId) {
    if (visited.has(current.parentPlanId)) {
      throw new Error(
        `Cycle detected in plan hierarchy: "${current.parentPlanId}" already visited`
      );
    }
    visited.add(current.parentPlanId);
    depth++;
    current = plansMap.get(current.parentPlanId);
  }

  return depth;
}

export function canCreateSubPlan(currentDepth: number): boolean {
  return currentDepth < MAX_PLAN_DEPTH;
}

/**
 * Group plans by their `parentPlanId`. Root plans (no parent) are keyed under
 * the empty string `""`.
 */
export function buildPlanTree<T extends { planId: string; parentPlanId?: string }>(
  plans: T[]
): Map<string, T[]> {
  const tree = new Map<string, T[]>();
  for (const plan of plans) {
    const key = plan.parentPlanId ?? "";
    let children = tree.get(key);
    if (!children) {
      children = [];
      tree.set(key, children);
    }
    children.push(plan);
  }
  return tree;
}
