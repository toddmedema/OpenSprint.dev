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

export interface PlanInfo {
  planId: string;
  epicId: string;
  content: string;
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

  for (const plan of planInfos) {
    const depsSection = plan.content.match(/## Dependencies[\s\S]*?(?=##|$)/i);
    if (!depsSection) continue;
    const text = depsSection[0].toLowerCase();
    for (const other of planInfos) {
      if (other.planId === plan.planId) continue;
      const slug = other.planId.replace(/-/g, "[\\s-]*");
      if (new RegExp(slug, "i").test(text)) {
        addEdge(other.planId, plan.planId);
      }
    }
  }

  return edges;
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
