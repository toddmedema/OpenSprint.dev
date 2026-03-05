import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import type { DbClient } from "../db/client.js";
import { runSchema } from "../db/schema.js";
import {
  migrateProjectsWithClient,
  MIGRATION_KEYS,
  runMigrationFromRuntimeConfig,
} from "../../../../scripts/migrate-opensprint-to-db.ts";
import {
  buildVitestSchemaName,
  createTestPostgresClient,
  getTestDatabaseUrl,
  truncateTestDbTables,
} from "./test-db-helper.js";

let client: DbClient;
let pool: { end: () => Promise<void> };
let postgresAvailable = true;

function withVitestWorkerSchema(url: string): string {
  const runId = process.env.OPENSPRINT_VITEST_RUN_ID?.trim();
  const workerId = process.env.VITEST_POOL_ID?.trim() || process.env.VITEST_WORKER_ID?.trim();
  if (!runId && !workerId) return url;

  const schema = runId
    ? buildVitestSchemaName(runId, workerId ?? "main")
    : `vitest_${(workerId ?? "main").replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "main"}`;

  const parsed = new URL(url);
  const existingOptions = parsed.searchParams.get("options") ?? "";
  if (!existingOptions.includes("search_path=")) {
    const nextOptions = `${existingOptions} -c search_path=${schema},public`.trim();
    parsed.searchParams.set("options", nextOptions);
  }
  return parsed.toString();
}

describe("migrate-opensprint-to-db script", () => {
  beforeAll(async () => {
    const db = await createTestPostgresClient();
    if (!db) {
      postgresAvailable = false;
      return;
    }
    client = db.client;
    pool = db.pool;
    await runSchema(client);
  });

  beforeEach(async () => {
    if (!postgresAvailable) return;
    await truncateTestDbTables(client);
    await runSchema(client);
  });

  afterAll(async () => {
    if (postgresAvailable) {
      await pool.end();
    }
  });

  it.skipIf(!postgresAvailable)(
    "imports canonical files, is idempotent, deletes only canonical files, and preserves unknown files",
    async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opensprint-migrate-script-test-"));
      const repoPath = path.join(tempDir, "repo");
      const opensprintPath = path.join(repoPath, ".opensprint");
      const conversationsDir = path.join(opensprintPath, "conversations");
      const planningRunsDir = path.join(opensprintPath, "planning-runs");
      const agentsDir = path.join(opensprintPath, "agents");
      const activeDir = path.join(opensprintPath, "active");

      await fs.mkdir(conversationsDir, { recursive: true });
      await fs.mkdir(planningRunsDir, { recursive: true });
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.mkdir(activeDir, { recursive: true });

      await fs.writeFile(
        path.join(opensprintPath, "spec-metadata.json"),
        JSON.stringify(
          {
            version: 3,
            changeLog: [{ section: "executive_summary", version: 3 }],
            sectionVersions: { executive_summary: 3 },
          },
          null,
          2
        ),
        "utf-8"
      );

      await fs.writeFile(
        path.join(conversationsDir, "sketch.json"),
        JSON.stringify(
          {
            id: "conv-1",
            context: "sketch",
            messages: [{ role: "user", content: "hi", timestamp: new Date().toISOString() }],
          },
          null,
          2
        ),
        "utf-8"
      );

      await fs.writeFile(
        path.join(conversationsDir, "help.json"),
        JSON.stringify(
          {
            messages: [{ role: "assistant", content: "hello" }],
          },
          null,
          2
        ),
        "utf-8"
      );

      await fs.writeFile(
        path.join(planningRunsDir, "run-1.json"),
        JSON.stringify(
          {
            id: "run-1",
            created_at: "2026-01-01T00:00:00.000Z",
            prd_snapshot: { version: 1, sections: {}, changeLog: [] },
            plans_created: ["plan-a"],
          },
          null,
          2
        ),
        "utf-8"
      );

      await fs.writeFile(path.join(agentsDir, "coder.md"), "# Coder", "utf-8");
      await fs.writeFile(path.join(agentsDir, "custom.md"), "# Unknown Role", "utf-8");
      await fs.writeFile(
        path.join(opensprintPath, "workflow.json"),
        JSON.stringify({ id: "w1" }),
        "utf-8"
      );

      await fs.writeFile(path.join(opensprintPath, "notes.txt"), "leave me", "utf-8");
      await fs.writeFile(path.join(activeDir, "runtime.log"), "runtime", "utf-8");

      const project = { id: "proj-1", name: "Project 1", repoPath };

      const first = await migrateProjectsWithClient(client, [project]);
      expect(first.migratedProjects).toBe(1);
      expect(first.skippedProjects).toBe(0);
      expect(first.projectErrors).toEqual([]);

      const prdRow = await client.queryOne(
        "SELECT version FROM prd_metadata WHERE project_id = $1",
        [project.id]
      );
      expect(prdRow?.version).toBe(3);

      const convRow = await client.queryOne(
        "SELECT conversation_id, context FROM project_conversations WHERE project_id = $1 AND context = $2",
        [project.id, "sketch"]
      );
      expect(convRow?.conversation_id).toBe("conv-1");
      expect(convRow?.context).toBe("sketch");

      const runRow = await client.queryOne(
        "SELECT id FROM planning_runs WHERE id = $1 AND project_id = $2",
        ["run-1", project.id]
      );
      expect(runRow?.id).toBe("run-1");

      const agentRow = await client.queryOne(
        "SELECT content FROM agent_instructions WHERE project_id = $1 AND role = $2",
        [project.id, "coder"]
      );
      expect(agentRow?.content).toBe("# Coder");

      const workflowRow = await client.queryOne(
        "SELECT workflow FROM project_workflows WHERE project_id = $1",
        [project.id]
      );
      expect(workflowRow?.workflow).toBe(JSON.stringify({ id: "w1" }));

      const helpRow = await client.queryOne(
        "SELECT messages FROM help_chat_histories WHERE scope_key = $1",
        [`project:${project.id}`]
      );
      expect(helpRow).toBeDefined();

      const migrationRows = await client.query(
        "SELECT migration_key FROM repo_file_migrations WHERE project_id = $1 ORDER BY migration_key",
        [project.id]
      );
      expect(migrationRows.map((r) => r.migration_key)).toEqual([
        MIGRATION_KEYS.agentInstructions,
        MIGRATION_KEYS.helpChatHistories,
        MIGRATION_KEYS.planningRuns,
        MIGRATION_KEYS.prdMetadata,
        MIGRATION_KEYS.projectConversations,
        MIGRATION_KEYS.projectWorkflow,
      ]);

      await expect(fs.stat(path.join(opensprintPath, "spec-metadata.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(fs.stat(path.join(conversationsDir, "sketch.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(fs.stat(path.join(conversationsDir, "help.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(fs.stat(path.join(planningRunsDir, "run-1.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(fs.stat(path.join(agentsDir, "coder.md"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(fs.stat(path.join(opensprintPath, "workflow.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });

      await expect(fs.readFile(path.join(agentsDir, "custom.md"), "utf-8")).resolves.toBe(
        "# Unknown Role"
      );
      await expect(fs.readFile(path.join(opensprintPath, "notes.txt"), "utf-8")).resolves.toBe(
        "leave me"
      );
      await expect(fs.readFile(path.join(activeDir, "runtime.log"), "utf-8")).resolves.toBe(
        "runtime"
      );

      expect(first.untouchedUnknownFiles).toContainEqual({
        projectId: project.id,
        projectName: project.name,
        files: expect.arrayContaining(["agents/custom.md", "notes.txt", "active/runtime.log"]),
      });

      const second = await migrateProjectsWithClient(client, [project]);
      expect(second.migratedProjects).toBe(0);
      expect(second.skippedProjects).toBe(1);
      expect(second.projectErrors).toEqual([]);

      await fs.rm(tempDir, { recursive: true, force: true });
    }
  );

  it.skipIf(!postgresAvailable)(
    "keeps the DB pool alive through runtime-config migration execution",
    async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opensprint-migrate-runtime-test-"));
      const tempHome = path.join(tempDir, "home");
      const repoPath = path.join(tempDir, "repo");
      const opensprintPath = path.join(repoPath, ".opensprint");
      const projectId = `proj-${randomUUID()}`;
      const projectName = "Runtime Config Project";
      const originalHome = process.env.HOME;
      const originalDatabaseUrl = process.env.DATABASE_URL;

      try {
        await fs.mkdir(opensprintPath, { recursive: true });
        await fs.writeFile(
          path.join(opensprintPath, "spec-metadata.json"),
          JSON.stringify(
            {
              version: 7,
              changeLog: [{ section: "overview", version: 7 }],
              sectionVersions: { overview: 7 },
            },
            null,
            2
          ),
          "utf-8"
        );

        await fs.mkdir(path.join(tempHome, ".opensprint"), { recursive: true });
        await fs.writeFile(
          path.join(tempHome, ".opensprint", "projects.json"),
          JSON.stringify(
            {
              projects: [
                {
                  id: projectId,
                  name: projectName,
                  repoPath,
                  createdAt: new Date().toISOString(),
                },
              ],
            },
            null,
            2
          ),
          "utf-8"
        );

        process.env.HOME = tempHome;
        process.env.DATABASE_URL = withVitestWorkerSchema(await getTestDatabaseUrl());

        const stats = await runMigrationFromRuntimeConfig();
        expect(stats.projectErrors).toEqual([]);
        expect(stats.migratedProjects).toBe(1);
        expect(stats.skippedProjects).toBe(0);

        const prdRow = await client.queryOne(
          "SELECT version FROM prd_metadata WHERE project_id = $1",
          [projectId]
        );
        expect(prdRow?.version).toBe(7);

        await expect(
          fs.stat(path.join(opensprintPath, "spec-metadata.json"))
        ).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        if (originalHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = originalHome;
        }
        if (originalDatabaseUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = originalDatabaseUrl;
        }
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    }
  );
});
