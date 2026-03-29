/**
 * Schema content tests. Only imports from db/schema.ts (no Drizzle or DB).
 */
import { describe, it, expect } from "vitest";
import { getSchemaSql, runSchema, SCHEMA_SQL, SCHEMA_SQL_SQLITE } from "../db/schema.js";

describe("schema", () => {
  it("runSchema succeeds for Postgres (mock client)", async () => {
    const statements: string[] = [];
    await runSchema(
      {
        query: async (sql: string) => {
          statements.push(sql);
          return [];
        },
      },
      "postgres"
    );
    expect(statements.some((s) => s.includes("plan_versions"))).toBe(true);
    expect(statements.some((s) => s.includes("current_version_number"))).toBe(true);
    expect(
      statements.every((s) => /^(CREATE|ALTER)\b/i.test(s.trim()))
    ).toBe(true);
  });

  it("runSchema succeeds for SQLite (mock client)", async () => {
    const statements: string[] = [];
    await runSchema(
      {
        query: async (sql: string) => {
          statements.push(sql);
          if (sql.startsWith("PRAGMA table_info("))
            return [{ name: "project_id" }, { name: "plan_id" }];
          return [];
        },
      },
      "sqlite"
    );
    expect(statements.some((s) => s.includes("plan_versions"))).toBe(true);
  });

  it("Postgres schema includes plan_versions table and plans version columns", () => {
    const sql = getSchemaSql("postgres");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS plan_versions");
    expect(sql).toContain("project_id");
    expect(sql).toContain("plan_id");
    expect(sql).toContain("version_number");
    expect(sql).toContain("title");
    expect(sql).toContain("content");
    expect(sql).toContain("metadata");
    expect(sql).toContain("created_at");
    expect(sql).toContain("is_executed_version");
    expect(sql).toContain("SERIAL PRIMARY KEY");
    expect(sql).toContain("BOOLEAN");
    expect(sql).toContain("idx_plan_versions_project_plan_version");
    expect(sql).toContain("current_version_number");
    expect(sql).toContain("last_executed_version_number");
    expect(SCHEMA_SQL).toContain("plan_versions");
    expect(SCHEMA_SQL).toContain("current_version_number");
    expect(SCHEMA_SQL).toContain("last_executed_version_number");
  });

  it("SQLite schema includes plan_versions table and plans version columns", () => {
    const sql = getSchemaSql("sqlite");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS plan_versions");
    expect(sql).toContain("INTEGER PRIMARY KEY AUTOINCREMENT");
    expect(sql).toContain("is_executed_version");
    expect(sql).toContain("INTEGER NOT NULL DEFAULT 0");
    expect(sql).toContain("idx_plan_versions_project_plan_version");
    expect(sql).toContain("current_version_number");
    expect(sql).toContain("last_executed_version_number");
    expect(SCHEMA_SQL_SQLITE).toContain("plan_versions");
    expect(SCHEMA_SQL_SQLITE).toContain("current_version_number");
    expect(SCHEMA_SQL_SQLITE).toContain("last_executed_version_number");
  });

  it("Postgres and SQLite schemas include plan_execute_batches table", () => {
    for (const dialect of ["postgres", "sqlite"] as const) {
      const sql = getSchemaSql(dialect);
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS plan_execute_batches");
      expect(sql).toContain("idx_plan_execute_batches_project_running");
    }
  });

  it("Postgres and SQLite schemas include composite index on tasks (project_id, status)", () => {
    const expected =
      "CREATE INDEX IF NOT EXISTS idx_tasks_project_id_status ON tasks(project_id, status)";
    for (const dialect of ["postgres", "sqlite"] as const) {
      const sql = getSchemaSql(dialect);
      expect(sql).toContain(expected);
    }
    expect(SCHEMA_SQL).toContain("idx_tasks_project_id_status");
    expect(SCHEMA_SQL_SQLITE).toContain("idx_tasks_project_id_status");
  });

  it("runSchema emits tasks composite index for Postgres and SQLite", async () => {
    const indexStmt =
      "CREATE INDEX IF NOT EXISTS idx_tasks_project_id_status ON tasks(project_id, status)";
    for (const dialect of ["postgres", "sqlite"] as const) {
      const statements: string[] = [];
      await runSchema(
        {
          query: async (sql: string) => {
            statements.push(sql);
            if (sql.startsWith("PRAGMA table_info("))
              return [{ name: "project_id" }, { name: "plan_id" }];
            return [];
          },
        },
        dialect
      );
      expect(statements.some((s) => s.includes(indexStmt))).toBe(true);
    }
  });

  it("Postgres schema includes integration_connections table", () => {
    const sql = getSchemaSql("postgres");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS integration_connections");
    expect(sql).toContain("access_token_enc");
    expect(sql).toContain("refresh_token_enc");
    expect(sql).toContain("provider_resource_id");
    expect(sql).toContain("UNIQUE (project_id, provider)");
    expect(sql).toContain("idx_integration_connections_project_id");
    expect(sql).toContain("idx_integration_connections_project_provider_status");
  });

  it("SQLite schema includes integration_connections table", () => {
    const sql = getSchemaSql("sqlite");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS integration_connections");
    expect(sql).toContain("access_token_enc");
    expect(sql).toContain("UNIQUE (project_id, provider)");
    expect(sql).toContain("idx_integration_connections_project_id");
    expect(sql).toContain("idx_integration_connections_project_provider_status");
  });

  it("Postgres schema includes integration_import_ledger with SERIAL PK", () => {
    const sql = getSchemaSql("postgres");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS integration_import_ledger");
    expect(sql).toContain("external_item_id");
    expect(sql).toContain("feedback_id");
    expect(sql).toContain("import_status");
    expect(sql).toContain("retry_count");
    expect(sql).toContain("UNIQUE (project_id, provider, external_item_id)");
    expect(sql).toContain("idx_integration_import_ledger_project_provider_status");
    const ledgerMatch = sql.match(/CREATE TABLE IF NOT EXISTS integration_import_ledger[^;]+/);
    expect(ledgerMatch?.[0]).toContain("SERIAL PRIMARY KEY");
  });

  it("SQLite schema includes integration_import_ledger with AUTOINCREMENT PK", () => {
    const sql = getSchemaSql("sqlite");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS integration_import_ledger");
    expect(sql).toContain("UNIQUE (project_id, provider, external_item_id)");
    expect(sql).toContain("idx_integration_import_ledger_project_provider_status");
    const ledgerMatch = sql.match(/CREATE TABLE IF NOT EXISTS integration_import_ledger[^;]+/);
    expect(ledgerMatch?.[0]).toContain("INTEGER PRIMARY KEY AUTOINCREMENT");
  });

  it("runSchema emits integration table statements for both dialects", async () => {
    for (const dialect of ["postgres", "sqlite"] as const) {
      const statements: string[] = [];
      await runSchema(
        {
          query: async (sql: string) => {
            statements.push(sql);
            if (sql.startsWith("PRAGMA table_info("))
              return [{ name: "project_id" }, { name: "plan_id" }];
            return [];
          },
        },
        dialect
      );
      expect(statements.some((s) => s.includes("integration_connections"))).toBe(true);
      expect(statements.some((s) => s.includes("integration_import_ledger"))).toBe(true);
      expect(
        statements.some((s) =>
          s.includes("idx_integration_import_ledger_project_provider_status")
        )
      ).toBe(true);
    }
  });

  it("Postgres schema includes parent_plan_id column and index on plans", () => {
    const sql = getSchemaSql("postgres");
    const plansMatch = sql.match(/CREATE TABLE IF NOT EXISTS plans\s*\([^;]+\)/);
    expect(plansMatch?.[0]).toContain("parent_plan_id");
    expect(sql).toContain("ALTER TABLE plans ADD COLUMN IF NOT EXISTS parent_plan_id TEXT");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_plans_parent ON plans(project_id, parent_plan_id)");
  });

  it("SQLite schema includes parent_plan_id column and index on plans", () => {
    const sql = getSchemaSql("sqlite");
    const plansMatch = sql.match(/CREATE TABLE IF NOT EXISTS plans\s*\([^;]+\)/);
    expect(plansMatch?.[0]).toContain("parent_plan_id");
    expect(sql).toContain("ALTER TABLE plans ADD COLUMN IF NOT EXISTS parent_plan_id TEXT");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_plans_parent ON plans(project_id, parent_plan_id)");
  });

  it("runSchema emits parent_plan_id ALTER and index for both dialects", async () => {
    for (const dialect of ["postgres", "sqlite"] as const) {
      const statements: string[] = [];
      await runSchema(
        {
          query: async (sql: string) => {
            statements.push(sql);
            if (sql.startsWith("PRAGMA table_info("))
              return [{ name: "project_id" }, { name: "plan_id" }];
            return [];
          },
        },
        dialect
      );
      expect(statements.some((s) => s.includes("idx_plans_parent"))).toBe(true);
      const parentIndexIdx = statements.findIndex((s) => s.includes("idx_plans_parent"));
      expect(parentIndexIdx).toBeGreaterThanOrEqual(0);
      if (dialect === "postgres") {
        const parentAlterIdx = statements.findIndex((s) =>
          s.includes("ADD COLUMN IF NOT EXISTS parent_plan_id")
        );
        expect(
          statements.some((s) => s.includes("ADD COLUMN IF NOT EXISTS parent_plan_id"))
        ).toBe(true);
        expect(parentAlterIdx).toBeLessThan(parentIndexIdx);
      } else {
        const parentAlterIdx = statements.findIndex((s) =>
          s.includes("ALTER TABLE plans ADD COLUMN parent_plan_id")
        );
        expect(
          statements.some((s) =>
            s.includes("ALTER TABLE plans ADD COLUMN parent_plan_id")
          )
        ).toBe(true);
        expect(parentAlterIdx).toBeLessThan(parentIndexIdx);
      }
    }
  });

  it("Postgres and SQLite schemas include prd_snapshots table", () => {
    const pg = getSchemaSql("postgres");
    const sqlite = getSchemaSql("sqlite");
    for (const sql of [pg, sqlite]) {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS prd_snapshots");
      expect(sql).toContain("project_id");
      expect(sql).toContain("version");
      expect(sql).toContain("content");
      expect(sql).toContain("created_at");
      expect(sql).toContain("PRIMARY KEY (project_id, version)");
      expect(sql).toContain("idx_prd_snapshots_project_id");
    }
    expect(SCHEMA_SQL).toContain("prd_snapshots");
    expect(SCHEMA_SQL_SQLITE).toContain("prd_snapshots");
  });
});
