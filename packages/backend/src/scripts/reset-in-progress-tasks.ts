/**
 * One-off script: set all tasks currently "in progress" to "open" and unassigned.
 * Use when you want to clear in-progress state (e.g. after a crash or to re-queue work).
 *
 * Usage: from repo root or packages/backend:
 *   npx tsx packages/backend/src/scripts/reset-in-progress-tasks.ts
 * or from packages/backend:
 *   npx tsx src/scripts/reset-in-progress-tasks.ts
 */

import { taskStore } from "../services/task-store.service.js";

async function main(): Promise<void> {
  const projectIds = await taskStore.listProjectIdsWithInProgressTasks();
  if (projectIds.length === 0) {
    console.log("No projects have in-progress tasks. Nothing to do.");
    return;
  }

  let totalReset = 0;
  for (const projectId of projectIds) {
    const tasks = await taskStore.listAll(projectId);
    const inProgress = tasks.filter((t) => t.status === "in_progress");
    for (const task of inProgress) {
      await taskStore.update(projectId, task.id, { status: "open", assignee: "" });
      console.log(`Reset task ${task.id} (${task.title ?? "untitled"}) to open`);
      totalReset++;
    }
  }

  console.log(`Done. Reset ${totalReset} task(s) to open/unassigned.`);
}

main().catch((err) => {
  console.error("reset-in-progress-tasks failed:", err);
  process.exit(1);
});
