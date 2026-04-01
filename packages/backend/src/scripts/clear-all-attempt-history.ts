/**
 * Deletes execute attempt history for all tasks in the app database:
 * - Clears agent_sessions, agent_stats, orchestrator_events (all rows).
 * - For every task: removes `attempts:N` labels and strips `last_execution_summary` and
 *   `next_retry_context` from extra JSON (cumulative attempt counter + retry/failure context).
 *
 * Usage (from repo root):
 *   npx tsx packages/backend/src/scripts/clear-all-attempt-history.ts
 * or from packages/backend:
 *   npx tsx src/scripts/clear-all-attempt-history.ts
 *
 * Uses the same DATABASE_URL / global-settings resolution as the backend.
 */

import { toPgParams } from "../db/sql-params.js";
import { taskStore } from "../services/task-store.service.js";

const ATTEMPTS_LABEL = /^attempts:\d+$/;

function scrubExtra(raw: string | undefined): Record<string, unknown> {
  const extra: Record<string, unknown> = raw
    ? (JSON.parse(raw || "{}") as Record<string, unknown>)
    : {};
  delete extra.last_execution_summary;
  delete extra.next_retry_context;
  return extra;
}

async function main(): Promise<void> {
  await taskStore.init();
  const now = new Date().toISOString();

  const result = await taskStore.runWrite(async (client) => {
    const delSessions = await client.execute("DELETE FROM agent_sessions", []);
    const delStats = await client.execute("DELETE FROM agent_stats", []);
    const delEvents = await client.execute("DELETE FROM orchestrator_events", []);

    const rows = await client.query(
      toPgParams("SELECT id, project_id, labels, extra FROM tasks"),
      []
    );

    let tasksUpdated = 0;
    for (const row of rows) {
      const id = row.id as string;
      const projectId = row.project_id as string;
      const labels: string[] = JSON.parse((row.labels as string) || "[]");
      const filtered = labels.filter((l) => !ATTEMPTS_LABEL.test(l));
      const extra = scrubExtra(row.extra as string | undefined);
      const labelsJson = JSON.stringify(filtered);
      const extraJson = JSON.stringify(extra);

      if (labelsJson === (row.labels as string) && extraJson === (row.extra as string || "{}")) {
        continue;
      }

      await client.execute(
        toPgParams("UPDATE tasks SET labels = ?, extra = ?, updated_at = ? WHERE id = ? AND project_id = ?"),
        [labelsJson, extraJson, now, id, projectId]
      );
      tasksUpdated += 1;
    }

    return { delSessions, delStats, delEvents, tasksUpdated, taskRows: rows.length };
  });

  console.log(
    `Cleared attempt history: agent_sessions=${result.delSessions} rows, agent_stats=${result.delStats} rows, orchestrator_events=${result.delEvents} rows; updated ${result.tasksUpdated}/${result.taskRows} task row(s) (labels/extra).`
  );
  await taskStore.closePool();
}

main().catch((err) => {
  console.error("clear-all-attempt-history failed:", err);
  process.exit(1);
});
