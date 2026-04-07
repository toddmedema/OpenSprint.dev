/**
 * Plan dependency graph: build edges from task store + markdown, list plans with edges.
 * Pure edge-building logic; listPlansWithEdges takes store/getPlan callbacks to avoid circular deps.
 */
import type {
  Plan,
  PlanDependencyGraph,
  PlanDependencyEdge,
  PlanHierarchyEdge,
} from "@opensprint/shared";
import { getEpicId } from "@opensprint/shared";
import { createLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/error-utils.js";
import type { StoredTask } from "../task-store.service.js";

const log = createLogger("plan");

function findDirectedCycleInBlocksGraph(
  nodeSet: Set<string>,
  adj: Map<string, string[]>
): string[] | null {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];

  function dfs(u: string): string[] | null {
    visited.add(u);
    inStack.add(u);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      if (!nodeSet.has(v)) continue;
      if (!visited.has(v)) {
        const c = dfs(v);
        if (c) return c;
      } else if (inStack.has(v)) {
        const i = stack.indexOf(v);
        return stack.slice(i);
      }
    }
    stack.pop();
    inStack.delete(u);
    return null;
  }

  for (const n of nodeSet) {
    if (!visited.has(n)) {
      const c = dfs(n);
      if (c) return c;
    }
  }
  return null;
}

/**
 * Validates that `blocks` edges among `allPlanIds` form a DAG (topological order exists).
 * Returns one directed cycle path when invalid (for messaging). `related` edges are ignored.
 */
export function validatePlanDependencyDAG(
  edges: PlanDependencyEdge[],
  allPlanIds: string[]
): { valid: boolean; cycle?: string[] } {
  const nodeSet = new Set(allPlanIds);
  const relevantEdges = edges.filter(
    (e) => e.type === "blocks" && nodeSet.has(e.from) && nodeSet.has(e.to)
  );

  for (const e of relevantEdges) {
    if (e.from === e.to) {
      return { valid: false, cycle: [e.from] };
    }
  }

  const adj = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of nodeSet) {
    indegree.set(id, 0);
    adj.set(id, []);
  }

  const edgeKey = new Set<string>();
  for (const e of relevantEdges) {
    const key = `${e.from}->${e.to}`;
    if (edgeKey.has(key)) continue;
    edgeKey.add(key);
    adj.get(e.from)!.push(e.to);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const id of nodeSet) {
    if ((indegree.get(id) ?? 0) === 0) queue.push(id);
  }

  let processed = 0;
  while (queue.length > 0) {
    const u = queue.shift()!;
    processed++;
    for (const v of adj.get(u) ?? []) {
      const nd = (indegree.get(v) ?? 0) - 1;
      indegree.set(v, nd);
      if (nd === 0) queue.push(v);
    }
  }

  if (processed === nodeSet.size) {
    return { valid: true };
  }

  const cycle = findDirectedCycleInBlocksGraph(nodeSet, adj);
  return { valid: false, cycle: cycle ?? undefined };
}

function stripCycleFormingPlanDependencyEdges(
  edges: PlanDependencyEdge[],
  allPlanIds: string[]
): PlanDependencyEdge[] {
  let working = [...edges];
  const maxIterations = Math.max(1, edges.length + allPlanIds.length + 5);
  for (let iter = 0; iter < maxIterations; iter++) {
    const check = validatePlanDependencyDAG(working, allPlanIds);
    if (check.valid) return working;
    const c = check.cycle;
    if (!c?.length) break;

    let removed = false;
    for (let i = 0; i < c.length && !removed; i++) {
      const from = c[i]!;
      const to = c[(i + 1) % c.length]!;
      const idx = working.findIndex((e) => e.type === "blocks" && e.from === from && e.to === to);
      if (idx >= 0) {
        log.warn("Removing cyclic plan dependency edge (blocks)", { from, to, cycle: c });
        working = working.slice(0, idx).concat(working.slice(idx + 1));
        removed = true;
      }
    }
    if (!removed) break;
  }

  const finalCheck = validatePlanDependencyDAG(working, allPlanIds);
  if (!finalCheck.valid) {
    log.warn("Plan dependency graph remains cyclic after edge stripping", {
      cycle: finalCheck.cycle,
      planCount: allPlanIds.length,
    });
  }
  return working;
}

export interface PlanInfo {
  planId: string;
  epicId: string;
  content: string;
  /**
   * When set, markdown `## Dependencies` edges only match other plans with the same
   * parent (sibling group). Roots use undefined/null — they match each other only.
   */
  parentPlanId?: string | null;
}

/**
 * Build dependency edges from plan infos and full issue list.
 * Uses task store blockers and "## Dependencies" section in plan markdown.
 */
export function buildDependencyEdgesCore(
  planInfos: PlanInfo[],
  allIssues: StoredTask[]
): PlanDependencyEdge[] {
  const edges: PlanDependencyEdge[] = [];
  const seenEdges = new Set<string>();
  const epicToPlan = new Map(planInfos.filter((p) => p.epicId).map((p) => [p.epicId, p.planId]));

  const addEdge = (fromPlanId: string, toPlanId: string) => {
    if (fromPlanId === toPlanId) return;
    const key = `${fromPlanId}->${toPlanId}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ from: fromPlanId, to: toPlanId, type: "blocks" });
  };

  for (const issue of allIssues) {
    const deps = (issue.dependencies as Array<{ depends_on_id: string; type: string }>) ?? [];
    const blockers = deps.filter((d) => d.type === "blocks").map((d) => d.depends_on_id);
    const myEpicId = getEpicId(issue.id);
    const toPlanId = epicToPlan.get(myEpicId);
    if (!toPlanId) continue;
    for (const blockerId of blockers) {
      const blockerEpicId = getEpicId(blockerId);
      const fromPlanId = epicToPlan.get(blockerEpicId);
      if (fromPlanId && blockerEpicId !== myEpicId) {
        addEdge(fromPlanId, toPlanId);
      }
    }
  }

  const parentKey = (p: PlanInfo) => (p.parentPlanId ?? "").trim();
  for (const plan of planInfos) {
    const depsSection = plan.content.match(/## Dependencies[\s\S]*?(?=##|$)/i);
    if (!depsSection) continue;
    const text = depsSection[0].toLowerCase();
    const planParent = parentKey(plan);
    for (const other of planInfos) {
      if (other.planId === plan.planId) continue;
      if (parentKey(other) !== planParent) continue;
      const slug = other.planId.replace(/-/g, "[\\s-]*");
      if (new RegExp(slug, "i").test(text)) {
        addEdge(other.planId, plan.planId);
      }
    }
  }

  const planIds = planInfos.map((p) => p.planId);
  return stripCycleFormingPlanDependencyEdges(edges, planIds);
}

export interface ListPlansWithEdgesDeps {
  getPlanInfosFromStore: (projectId: string) => Promise<PlanInfo[]>;
  listAll: (projectId: string) => Promise<StoredTask[]>;
  getPlan: (
    projectId: string,
    planId: string,
    opts?: { allIssues?: StoredTask[]; edges?: PlanDependencyEdge[] }
  ) => Promise<Plan>;
}

/**
 * List all plans and build dependency edges in one pass (single listAll).
 * Uses getPlan with allIssues/edges to avoid redundant store calls.
 */
export async function listPlansWithEdges(
  projectId: string,
  deps: ListPlansWithEdgesDeps
): Promise<PlanDependencyGraph> {
  const planInfos = await deps.getPlanInfosFromStore(projectId);
  const allIssues = await deps.listAll(projectId);
  const edges = buildDependencyEdgesCore(planInfos, allIssues);

  const plans: Plan[] = [];
  for (const { planId } of planInfos) {
    try {
      const plan = await deps.getPlan(projectId, planId, { allIssues, edges });
      plans.push(plan);
    } catch (err) {
      log.warn("Skipping broken plan", { planId, err: getErrorMessage(err) });
    }
  }

  const hierarchyEdges: PlanHierarchyEdge[] = [];
  return { plans, edges, hierarchyEdges };
}
