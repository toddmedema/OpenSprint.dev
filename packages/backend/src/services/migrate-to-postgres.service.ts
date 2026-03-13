/**
 * One-way migration: copy all data from current DB (typically SQLite) to a target PostgreSQL database.
 * Used by the "Upgrade to PostgreSQL" flow in Settings.
 */

import { getDatabaseDialect } from "@opensprint/shared";
import type { DbRow } from "../db/client.js";
import { createPostgresDbClientFromUrl } from "../db/client.js";
import { runSchema } from "../db/schema.js";
import { initAppDb } from "../db/app-db.js";

const TABLES = [
  "tasks",
  "task_dependencies",
  "feedback",
  "feedback_inbox",
  "agent_sessions",
  "agent_stats",
  "orchestrator_events",
  "orchestrator_counters",
  "deployments",
  "plans",
  "auditor_runs",
  "self_improvement_runs",
  "open_questions",
  "prd_metadata",
  "project_conversations",
  "planning_runs",
  "agent_instructions",
  "project_workflows",
  "help_chat_histories",
  "repo_file_migrations",
] as const;

/** Tables that have SERIAL id in Postgres; omit id when inserting so Postgres generates. */
const SERIAL_ID_TABLES = new Set([
  "agent_sessions",
  "agent_stats",
  "orchestrator_events",
  "auditor_runs",
  "self_improvement_runs",
]);

function getInsertColumns(table: string, row: DbRow): string[] {
  const cols = Object.keys(row).filter((k) => row[k] !== undefined);
  if (SERIAL_ID_TABLES.has(table)) {
    return cols.filter((c) => c !== "id");
  }
  return cols;
}

function rowToValues(row: DbRow, columns: string[]): unknown[] {
  return columns.map((c) => row[c]);
}

export async function migrateSqliteToPostgres(sourceUrl: string, targetUrl: string): Promise<void> {
  const sourceDialect = getDatabaseDialect(sourceUrl);
  if (sourceDialect !== "sqlite") {
    throw new Error("Source must be SQLite");
  }
  if (getDatabaseDialect(targetUrl) !== "postgres") {
    throw new Error("Target must be PostgreSQL");
  }

  const sourceAppDb = await initAppDb(sourceUrl);
  const { client: targetClient, pool: targetPool } = await createPostgresDbClientFromUrl(targetUrl);

  try {
    await runSchema(targetClient, "postgres");

    const sourceClient = await sourceAppDb.getClient();

    await targetClient.runInTransaction(async (tx) => {
      for (const table of TABLES) {
        const rows = await sourceClient.query(`SELECT * FROM ${table}`);
        if (rows.length === 0) continue;

        const first = rows[0] as DbRow;
        const columns = getInsertColumns(table, first);
        if (columns.length === 0) continue;

        const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
        const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;

        for (const row of rows) {
          const values = rowToValues(row as DbRow, columns);
          await tx.execute(sql, values);
        }
      }
    });
  } finally {
    await sourceAppDb.close();
    await targetPool.end();
  }
}
