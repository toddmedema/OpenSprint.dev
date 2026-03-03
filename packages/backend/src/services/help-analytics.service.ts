import type { TaskAnalytics, TaskAnalyticsBucket } from "@opensprint/shared";
import { taskStore } from "./task-store.service.js";

const COMPLEXITY_MIN = 1;
const COMPLEXITY_MAX = 10;
const DEFAULT_LIMIT = 100;

/**
 * Compute task analytics from the 100 most recently completed tasks.
 * When projectId is provided, scope to that project; when null, all projects.
 * Groups by complexity (1-10). Completion time = completed_at - (started_at ?? created_at).
 */
export async function getTaskAnalytics(projectId: string | null): Promise<TaskAnalytics> {
  const tasks = await taskStore.listRecentlyCompletedTasks(projectId, DEFAULT_LIMIT);

  const buckets: Map<number, { taskCount: number; totalMs: number }> = new Map();
  for (let c = COMPLEXITY_MIN; c <= COMPLEXITY_MAX; c++) {
    buckets.set(c, { taskCount: 0, totalMs: 0 });
  }

  let totalTasks = 0;
  for (const t of tasks) {
    const complexity = t.complexity;
    if (complexity == null || complexity < COMPLEXITY_MIN || complexity > COMPLEXITY_MAX) continue;

    const bucket = buckets.get(complexity);
    if (!bucket) continue;

    const completedMs = new Date(t.completed_at).getTime();
    const startMs = t.started_at
      ? new Date(t.started_at).getTime()
      : new Date(t.created_at).getTime();
    const durationMs = Math.max(0, completedMs - startMs);

    bucket.taskCount += 1;
    bucket.totalMs += durationMs;
    totalTasks += 1;
  }

  const byComplexity: TaskAnalyticsBucket[] = [];
  for (let c = COMPLEXITY_MIN; c <= COMPLEXITY_MAX; c++) {
    const b = buckets.get(c)!;
    byComplexity.push({
      complexity: c,
      taskCount: b.taskCount,
      avgCompletionTimeMs: b.taskCount > 0 ? Math.round(b.totalMs / b.taskCount) : 0,
    });
  }

  return { byComplexity, totalTasks };
}
