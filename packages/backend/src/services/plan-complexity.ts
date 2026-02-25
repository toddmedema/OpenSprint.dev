import type { PlanComplexity, TaskComplexity } from "@opensprint/shared";
import {
  taskStore as taskStoreSingleton,
  type TaskStoreService,
  type StoredTask,
} from "./task-store.service.js";

const VALID_COMPLEXITIES: PlanComplexity[] = ["low", "medium", "high", "very_high"];

/** Map plan complexity to task complexity: low/medium -> low, high/very_high -> high */
export function planComplexityToTask(plan: PlanComplexity): TaskComplexity {
  return plan === "low" || plan === "medium" ? "low" : "high";
}

/**
 * Resolve task-level complexity: task's own value if set, else infer from epic's plan.
 * Returns undefined if no complexity can be determined.
 */
export function getTaskComplexity(
  task: StoredTask,
  planComplexity: PlanComplexity | undefined
): TaskComplexity | undefined {
  const own = (task as { complexity?: string }).complexity;
  if (own === "low" || own === "high") return own;
  if (planComplexity && VALID_COMPLEXITIES.includes(planComplexity)) {
    return planComplexityToTask(planComplexity);
  }
  return undefined;
}

/**
 * Resolve the plan complexity for a task by looking up its parent epic's plan in the task store.
 * Returns undefined if no complexity is found.
 */
export async function getPlanComplexityForTask(
  projectId: string,
  _repoPath: string,
  task: StoredTask,
  taskStore?: TaskStoreService
): Promise<PlanComplexity | undefined> {
  const store = taskStore ?? taskStoreSingleton;
  const parentId = store.getParentId(task.id);
  if (!parentId) return undefined;

  try {
    const plan = await store.planGetByEpicId(projectId, parentId);
    if (!plan?.metadata?.complexity) return undefined;
    const complexity = plan.metadata.complexity as string;
    if (VALID_COMPLEXITIES.includes(complexity as PlanComplexity)) {
      return complexity as PlanComplexity;
    }
  } catch {
    // Parent or plan might not exist
  }

  return undefined;
}

/**
 * Resolve complexity for agent selection: task's own complexity (mapped to PlanComplexity)
 * takes precedence; otherwise infer from epic's plan.
 */
export async function getComplexityForAgent(
  projectId: string,
  repoPath: string,
  task: StoredTask,
  taskStore?: TaskStoreService
): Promise<PlanComplexity | undefined> {
  const own = (task as { complexity?: string }).complexity;
  if (own === "low") return "low";
  if (own === "high") return "high";

  return getPlanComplexityForTask(projectId, repoPath, task, taskStore);
}
