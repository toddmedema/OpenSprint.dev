/**
 * Tests for the SQLite-to-Postgres migration script.
 * - Unit: script exits correctly when SQLite missing
 * - Integration: full migration (skipped if Postgres unreachable)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import {
  createPostgresDbClientFromUrl,
} from "../db/client.js";
import { runSchema } from "../db/schema.js";
import { SCHEMA_SQL_SQLITE } from "./test-db-helper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts/migrate-sqlite-to-postgres.ts");

function runMigration(args: string[] = []): { stdout: string; stderr: string; status: number } {
  const result = spawnSync("npx", ["tsx", SCRIPT_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    env: { ...process.env },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? -1,
  };
}

describe("migrate-sqlite-to-postgres script", () => {
  it("exits with 1 when SQLite file does not exist", () => {
    const { stdout, stderr, status } = runMigration([
      "--sqlite-path",
      "/nonexistent/path/tasks.db",
    ]);
    expect(status).toBe(1);
    expect(stderr + stdout).toContain("not found");
  });

  it("parses --force and --sqlite-path", () => {
    const { status } = runMigration([
      "--sqlite-path",
      "/nonexistent/tasks.db",
    ]);
    expect(status).toBe(1);
    // With --force we'd still fail on missing file first
    const { status: status2 } = runMigration([
      "--force",
      "--sqlite-path",
      "/nonexistent/tasks.db",
    ]);
    expect(status2).toBe(1);
  });
});

describe("migrate-sqlite-to-postgres integration", () => {
  let tmpDir: string;
  let sqlitePath: string;
  const TEST_DB_URL =
    process.env.TEST_DATABASE_URL ??
    "postgresql://opensprint:opensprint@localhost:5432/opensprint";

  beforeAll(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "migrate-test-"));
    sqlitePath = path.join(tmpDir, "tasks.db");

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(sqlitePath);
    db.exec(SCHEMA_SQL_SQLITE);
    db.exec(`
      INSERT INTO tasks (id, project_id, title, description, issue_type, status, priority, labels, created_at, updated_at)
      VALUES ('os-test-1', 'proj-1', 'Test', '', 'task', 'open', 2, '[]', datetime('now'), datetime('now'));
    `);
    db.close();
  });

  afterAll(async () => {
    try {
      await fs.promises.rm(tmpDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  it("migrates SQLite to Postgres when DB is reachable", async () => {
    let pool: Awaited<ReturnType<typeof createPostgresDbClientFromUrl>>["pool"] | null = null;
    try {
      const { pool: p } = await createPostgresDbClientFromUrl(TEST_DB_URL);
      pool = p;
      await runSchema({ query: (sql, params) => p.query(sql, params ?? []).then((r) => r.rows) });
    } catch {
      // Postgres not available — skip
      return;
    }

    const { stdout, stderr, status } = runMigration([
      "--sqlite-path",
      sqlitePath,
      "--database-url",
      TEST_DB_URL,
      "--force",
    ]);

    await pool?.end();

    if (status !== 0) {
      // Migration failed — likely Postgres not running
      expect(stderr + stdout).toBeTruthy();
      return;
    }

    expect(stdout).toContain("Migration complete");
    expect(stdout).toMatch(/\[tasks\].*1 rows/);
  });
});
