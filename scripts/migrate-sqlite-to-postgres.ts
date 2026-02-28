#!/usr/bin/env npx tsx
/**
 * One-time migration: copy ~/.opensprint/tasks.db (SQLite) to configured Postgres.
 *
 * - Reads databaseUrl from ~/.opensprint/global-settings.json
 * - Creates Postgres schema if needed
 * - Copies all tables: tasks, task_dependencies, feedback, feedback_inbox,
 *   agent_sessions, agent_stats, orchestrator_events, orchestrator_counters,
 *   deployments, plans, open_questions
 * - Uses transactions
 * - If Postgres tables already have rows, aborts unless --force
 *
 * Usage: npx tsx scripts/migrate-sqlite-to-postgres.ts [--force] [--sqlite-path PATH] [--database-url URL]
 */

import fs from "fs";
import path from "path";
import { getDatabaseUrl } from "../packages/backend/src/services/global-settings.service.js";
import { runSchema } from "../packages/backend/src/db/schema.js";
import {
  createPostgresDbClientFromUrl,
} from "../packages/backend/src/db/client.js";
import type { Pool } from "pg";

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
  "open_questions",
] as const;

function getSqlitePath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return path.join(home, ".opensprint", "tasks.db");
}

function tableExistsSqlite(db: { prepare: (sql: string) => { get: () => unknown } }): (name: string) => boolean {
  return (name: string) => {
    const row = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
    ).get(name) as { "1"?: number } | undefined;
    return !!row;
  };
}

function getTableColumnsSqlite(
  db: { prepare: (sql: string) => { all: (params?: unknown[]) => unknown[] } },
  table: string
): string[] {
  const safeTable = table.replace(/"/g, '""');
  const rows = db.prepare(`PRAGMA table_info("${safeTable}")`).all() as {
    name: string;
  }[];
  return rows.map((r) => r.name);
}

async function getTableColumnsPostgres(
  pool: Pool,
  table: string
): Promise<string[]> {
  const result = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return result.rows.map((r) => r.column_name as string);
}

async function countRows(pool: Pool, table: string): Promise<number> {
  const result = await pool.query(`SELECT COUNT(*)::int AS c FROM "${table}"`);
  return Number((result.rows[0] as { c: number })?.c ?? 0);
}

function parseArgs(): {
  force: boolean;
  sqlitePath: string;
  databaseUrl?: string;
} {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const pathIdx = args.indexOf("--sqlite-path");
  const sqlitePath =
    pathIdx >= 0 && args[pathIdx + 1]
      ? args[pathIdx + 1]
      : getSqlitePath();
  const urlIdx = args.indexOf("--database-url");
  const databaseUrl =
    urlIdx >= 0 && args[urlIdx + 1] ? args[urlIdx + 1] : undefined;
  return { force, sqlitePath, databaseUrl };
}

async function main(): Promise<void> {
  const { force, sqlitePath, databaseUrl: cliDatabaseUrl } = parseArgs();
  if (!fs.existsSync(sqlitePath)) {
    console.error(`SQLite database not found: ${sqlitePath}`);
    process.exit(1);
  }

  console.log(`Reading SQLite from ${sqlitePath}`);

  const Database = (await import("better-sqlite3")).default as new (
    path: string,
    opts?: { readonly?: boolean }
  ) => {
    prepare: (sql: string) => {
      get: (params?: unknown[]) => unknown;
      all: (params?: unknown[]) => unknown[];
    };
    close: () => void;
  };
  const sqlite = new Database(sqlitePath, { readonly: true });

  try {
    let databaseUrl: string | undefined = cliDatabaseUrl;
    if (!databaseUrl) {
      try {
        databaseUrl = await getDatabaseUrl();
      } catch (err) {
        console.error("Failed to read databaseUrl from global-settings:", err);
        process.exit(1);
      }
    }
    // Fallback: read directly if backend returns falsy (e.g. shared not built)
    if (!databaseUrl || typeof databaseUrl !== "string") {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
      const settingsPath = path.join(home, ".opensprint", "global-settings.json");
      try {
        const raw = fs.readFileSync(settingsPath, "utf-8");
        const parsed = JSON.parse(raw) as { databaseUrl?: string };
        databaseUrl =
          parsed?.databaseUrl ||
          "postgresql://opensprint:opensprint@localhost:5432/opensprint";
      } catch {
        databaseUrl = "postgresql://opensprint:opensprint@localhost:5432/opensprint";
      }
    }
    if (!databaseUrl || typeof databaseUrl !== "string") {
      console.error(
        "databaseUrl not configured. Run: npx tsx scripts/ensure-global-settings.ts"
      );
      process.exit(1);
    }
    const masked = databaseUrl.replace(/:[^:@]+@/, ":****@");
    console.log(`Connecting to Postgres at ${masked}`);

    const { client, pool } = await createPostgresDbClientFromUrl(databaseUrl);

    try {
      console.log("Creating schema if needed...");
      await runSchema({ query: (sql, params) => pool.query(sql, params ?? []).then((r) => r.rows) });

      const exists = tableExistsSqlite(sqlite);

      let totalExisting = 0;
      for (const table of TABLES) {
        if (!exists(table)) continue;
        const n = await countRows(pool, table);
        totalExisting += n;
      }

      if (totalExisting > 0 && !force) {
        console.error(
          `Postgres already has data (${totalExisting} row(s) across tables). Aborting. Use --force to overwrite.`
        );
        process.exit(1);
      }

      if (totalExisting > 0 && force) {
        console.log(`--force: truncating existing tables before migration...`);
        await client.runInTransaction(async (tx) => {
          for (const table of TABLES) {
            if (!exists(table)) continue;
            await tx.execute(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
          }
        });
      }

      let totalCopied = 0;
      await client.runInTransaction(async (tx) => {
        for (const table of TABLES) {
          if (!exists(table)) {
            console.log(`  [${table}] skipped (not in SQLite)`);
            continue;
          }

          const sqliteCols = getTableColumnsSqlite(sqlite, table);
          const pgCols = await getTableColumnsPostgres(pool, table);
          const cols = sqliteCols.filter((c) => pgCols.includes(c));
          if (cols.length === 0) {
            console.log(`  [${table}] skipped (no matching columns)`);
            continue;
          }

          const safeTable = table.replace(/"/g, '""');
          const rows = sqlite
            .prepare(`SELECT * FROM "${safeTable}"`)
            .all() as Record<string, unknown>[];
          if (rows.length === 0) {
            console.log(`  [${table}] 0 rows`);
            continue;
          }

          const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
          const colList = cols.map((c) => `"${c}"`).join(", ");
          const insertSql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`;

          for (const row of rows) {
            const vals = cols.map((c) => row[c]);
            await tx.execute(insertSql, vals);
          }

          totalCopied += rows.length;
          console.log(`  [${table}] ${rows.length} rows`);
        }
      });

      // Fix SERIAL sequences for tables that use them
      const serialTables = ["agent_sessions", "agent_stats", "orchestrator_events"];
      for (const table of serialTables) {
        if (!exists(table)) continue;
        const safeTable = table.replace(/"/g, '""');
        await pool.query(
          `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM "${safeTable}"), 1))`,
          [table]
        );
      }

      console.log(`Migration complete. ${totalCopied} row(s) copied.`);
    } finally {
      await pool.end();
    }
  } finally {
    sqlite.close();
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
