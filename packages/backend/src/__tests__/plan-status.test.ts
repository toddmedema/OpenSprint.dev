import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createApp } from "../app.js";
import { ProjectService } from "../services/project.service.js";
import { API_PREFIX, SPEC_MD, prdToSpecMarkdown } from "@opensprint/shared";
import { DEFAULT_HIL_CONFIG } from "@opensprint/shared";

// Avoid loading drizzle-orm/pg-core when task-store mock uses importOriginal (vitest resolution can fail)
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => [a, b],
}));
vi.mock("../db/drizzle-schema-pg.js", () => ({ plansTable: {} }));

const mockDecomposeInvoke = vi.fn();

async function writeSpec(
  repoPath: string,
  sections: Record<string, { content: string; version?: number; updatedAt?: string }>
): Promise<void> {
  const now = new Date().toISOString();
  const prd = {
    version: 1,
    sections: Object.fromEntries(
      Object.entries(sections).map(([k, v]) => [
        k,
        { content: v.content, version: v.version ?? 1, updatedAt: v.updatedAt ?? now },
      ])
    ),
    changeLog: [],
  };
  await fs.writeFile(path.join(repoPath, SPEC_MD), prdToSpecMarkdown(prd as never), "utf-8");
}

vi.mock("../services/task-store.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/task-store.service.js")>();
  const { createTestPostgresClient, truncateTestDbTables } = await import("./test-db-helper.js");
  const dbResult = await createTestPostgresClient();
  if (!dbResult) {
    return {
      ...actual,
      TaskStoreService: class {
        constructor() {
          throw new Error("Postgres required");
        }
      },
      taskStore: null,
      _postgresAvailable: false,
      _resetSharedDb: () => {},
    };
  }
  const store = new actual.TaskStoreService(dbResult.client);
  await store.init();
  const resetSharedDb = async () => {
    await truncateTestDbTables(dbResult.client);
  };
  return {
    ...actual,
    TaskStoreService: class extends actual.TaskStoreService {
      constructor() {
        super(dbResult.client);
      }
    },
    taskStore: store,
    _resetSharedDb: resetSharedDb,
    _postgresAvailable: true,
    _testPool: dbResult.pool,
  };
});

vi.mock("../services/agent-client.js", () => ({
  AgentClient: vi.fn().mockImplementation(() => ({
    invoke: (opts: unknown) => mockDecomposeInvoke(opts),
  })),
}));

vi.mock("../services/orchestrator.service.js", () => ({
  orchestratorService: {
    nudge: vi.fn(),
    ensureRunning: vi.fn(),
    stopProject: vi.fn(),
    getStatus: vi.fn().mockResolvedValue({
      activeTasks: [],
      queueDepth: 0,
      totalDone: 0,
      totalFailed: 0,
    }),
    getActiveAgents: vi.fn().mockResolvedValue([]),
  },
}));

const planStatusTaskStoreMod = await import("../services/task-store.service.js");
const planStatusPostgresOk =
  (planStatusTaskStoreMod as { _postgresAvailable?: boolean })._postgresAvailable ?? false;
const planStatusTaskStore = (
  planStatusTaskStoreMod as {
    taskStore: {
      getDb: () => Promise<{
        query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
        queryOne: (sql: string, params?: unknown[]) => Promise<Record<string, unknown> | undefined>;
        execute: (sql: string, params?: unknown[]) => Promise<number>;
      }>;
    };
  }
).taskStore;

describe.skipIf(!planStatusPostgresOk)("Plan status endpoint and planning run creation", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let projectId: string;
  let projectService: ProjectService;

  afterAll(async () => {
    const mod = (await import("../services/task-store.service.js")) as {
      _testPool?: { end: () => Promise<void> };
    };
    if (mod._testPool) await mod._testPool.end();
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opensprint-plan-status-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    projectService = new ProjectService();
    const repoPath = path.join(tempDir, "test-project");
    const project = await projectService.createProject({
      name: "Plan Status Test",
      repoPath,
      simpleComplexityAgent: { type: "cursor", model: "claude-sonnet-4", cliCommand: null },
      complexComplexityAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
      deployment: { mode: "custom" },
      hilConfig: DEFAULT_HIL_CONFIG,
    });
    projectId = project.id;
  });

  afterEach(async () => {
    if (planStatusTaskStore && projectId) {
      try {
        const db = await planStatusTaskStore.getDb();
        await db.execute("DELETE FROM planning_runs WHERE project_id = $1", [projectId]);
      } catch {
        // Ignore if store unavailable or already torn down
      }
    }
    process.env.HOME = originalHome;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("GET /projects/:id/plan-status returns action plan when no planning run exists", async () => {
    const project = await projectService.getProject(projectId);
    await writeSpec(project.repoPath, { executive_summary: { content: "A todo app" } });

    const app = createApp();
    const res = await request(app).get(`${API_PREFIX}/projects/${projectId}/plan-status`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      hasPlanningRun: false,
      prdChangedSinceLastRun: false,
      action: "plan",
    });
  });

  it("GET /projects/:id/plan-status returns MIGRATION_REQUIRED when legacy planning-runs files exist", async () => {
    const project = await projectService.getProject(projectId);
    await writeSpec(project.repoPath, { executive_summary: { content: "A todo app" } });
    const legacyRunsDir = path.join(project.repoPath, ".opensprint", "planning-runs");
    await fs.mkdir(legacyRunsDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyRunsDir, "legacy-run.json"),
      JSON.stringify({
        id: "legacy-run",
        created_at: "2025-01-01T00:00:00.000Z",
        prd_snapshot: { version: 1, sections: {}, changeLog: [] },
        plans_created: [],
      }),
      "utf-8"
    );

    const app = createApp();
    const res = await request(app).get(`${API_PREFIX}/projects/${projectId}/plan-status`);

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("MIGRATION_REQUIRED");
  });

  it(
    "POST decompose creates planning run; plan-status returns none when PRD unchanged",
    {
      timeout: 15000,
    },
    async () => {
      mockDecomposeInvoke.mockResolvedValueOnce({
        content: JSON.stringify({
          plans: [
            {
              title: "Task CRUD",
              content: "# Task CRUD\n\n## Overview\n\nCreate tasks.",
              complexity: "medium",
              mockups: [{ title: "List", content: "Tasks" }],
              tasks: [
                { title: "Create model", description: "Task schema", priority: 0, dependsOn: [] },
              ],
            },
          ],
        }),
      });

      const project = await projectService.getProject(projectId);
      await writeSpec(project.repoPath, { executive_summary: { content: "A todo app" } });

      const app = createApp();

      const decomposeRes = await request(app).post(
        `${API_PREFIX}/projects/${projectId}/plans/decompose`
      );
      expect(decomposeRes.status).toBe(201);

      const db = await planStatusTaskStore.getDb();
      const rows = await db.query(
        "SELECT id FROM planning_runs WHERE project_id = $1 ORDER BY created_at DESC",
        [projectId]
      );
      expect(rows.length).toBe(1);

      const statusRes = await request(app).get(`${API_PREFIX}/projects/${projectId}/plan-status`);
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.data).toEqual({
        hasPlanningRun: true,
        prdChangedSinceLastRun: false,
        action: "none",
      });
    }
  );

  it("plan-status returns replan when PRD changed since last run", { timeout: 15000 }, async () => {
    mockDecomposeInvoke.mockResolvedValueOnce({
      content: JSON.stringify({
        plans: [
          {
            title: "Task CRUD",
            content: "# Task CRUD\n\n## Overview\n\nCreate tasks.",
            complexity: "medium",
            mockups: [{ title: "List", content: "Tasks" }],
            tasks: [
              { title: "Create model", description: "Task schema", priority: 0, dependsOn: [] },
            ],
          },
        ],
      }),
    });

    const project = await projectService.getProject(projectId);
    await writeSpec(project.repoPath, { executive_summary: { content: "A todo app" } });

    const app = createApp();
    await request(app).post(`${API_PREFIX}/projects/${projectId}/plans/decompose`);

    await writeSpec(project.repoPath, {
      executive_summary: { content: "A todo app with new features" },
    });

    const statusRes = await request(app).get(`${API_PREFIX}/projects/${projectId}/plan-status`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data).toEqual({
      hasPlanningRun: true,
      prdChangedSinceLastRun: true,
      action: "replan",
    });
  });

  it(
    "planning run stores prd_snapshot and plans_created for replan diff",
    {
      timeout: 15000,
    },
    async () => {
      mockDecomposeInvoke.mockResolvedValueOnce({
        content: JSON.stringify({
          plans: [
            {
              title: "Feature A",
              content: "# Feature A",
              complexity: "low",
              mockups: [],
              tasks: [{ title: "Task 1", description: "d1", priority: 0, dependsOn: [] }],
            },
          ],
        }),
      });

      const project = await projectService.getProject(projectId);
      await writeSpec(project.repoPath, {
        executive_summary: { content: "Original PRD" },
      });

      const app = createApp();
      const decomposeRes = await request(app).post(
        `${API_PREFIX}/projects/${projectId}/plans/decompose`
      );
      expect(decomposeRes.status).toBe(201);

      const db = await planStatusTaskStore.getDb();
      const row = await db.queryOne(
        "SELECT id, created_at, prd_snapshot, plans_created FROM planning_runs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1",
        [projectId]
      );
      expect(row).toBeDefined();
      const runData = {
        id: String(row?.id ?? ""),
        created_at: String(row?.created_at ?? ""),
        prd_snapshot: JSON.parse(String(row?.prd_snapshot ?? "{}")),
        plans_created: JSON.parse(String(row?.plans_created ?? "[]")),
      };
      expect(runData).toMatchObject({
        id: expect.any(String),
        created_at: expect.any(String),
        prd_snapshot: expect.objectContaining({
          sections: expect.objectContaining({
            executive_summary: expect.objectContaining({ content: "Original PRD" }),
          }),
        }),
        plans_created: expect.any(Array),
      });
      expect(runData.plans_created.length).toBe(1);
    }
  );

  it(
    "replan diff: plan-status returns replan when only one section changes",
    {
      timeout: 15000,
    },
    async () => {
      mockDecomposeInvoke.mockResolvedValueOnce({
        content: JSON.stringify({
          plans: [
            {
              title: "Feature",
              content: "# Feature",
              complexity: "medium",
              mockups: [],
              tasks: [{ title: "T1", description: "d", priority: 0, dependsOn: [] }],
            },
          ],
        }),
      });

      const project = await projectService.getProject(projectId);
      await writeSpec(project.repoPath, {
        executive_summary: { content: "Section A" },
        goals_and_metrics: { content: "Section B" },
      });

      const app = createApp();
      await request(app).post(`${API_PREFIX}/projects/${projectId}/plans/decompose`);

      await writeSpec(project.repoPath, {
        executive_summary: { content: "Section A modified" },
        goals_and_metrics: { content: "Section B" },
      });

      const statusRes = await request(app).get(`${API_PREFIX}/projects/${projectId}/plan-status`);
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.data.action).toBe("replan");
      expect(statusRes.body.data.prdChangedSinceLastRun).toBe(true);
    }
  );

  it("plan-status uses latest run when multiple runs exist", async () => {
    const project = await projectService.getProject(projectId);
    await writeSpec(project.repoPath, { executive_summary: { content: "v1" } });

    const prdContent = {
      version: 1,
      sections: {
        executive_summary: { content: "v1", version: 1, updatedAt: new Date().toISOString() },
        problem_statement: { content: "", version: 0, updatedAt: new Date().toISOString() },
        user_personas: { content: "", version: 0, updatedAt: new Date().toISOString() },
        goals_and_metrics: { content: "", version: 0, updatedAt: new Date().toISOString() },
        feature_list: { content: "", version: 0, updatedAt: new Date().toISOString() },
        technical_architecture: { content: "", version: 0, updatedAt: new Date().toISOString() },
        data_model: { content: "", version: 0, updatedAt: new Date().toISOString() },
        api_contracts: { content: "", version: 0, updatedAt: new Date().toISOString() },
        non_functional_requirements: {
          content: "",
          version: 0,
          updatedAt: new Date().toISOString(),
        },
        open_questions: { content: "", version: 0, updatedAt: new Date().toISOString() },
      },
      changeLog: [],
    };

    const db = await planStatusTaskStore.getDb();
    await db.execute("DELETE FROM planning_runs WHERE project_id = $1", [projectId]);
    await db.execute(
      `INSERT INTO planning_runs (id, project_id, created_at, prd_snapshot, plans_created)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        "run-older",
        projectId,
        "2025-01-01T00:00:00Z",
        JSON.stringify(prdContent),
        JSON.stringify(["plan-1"]),
      ]
    );
    await db.execute(
      `INSERT INTO planning_runs (id, project_id, created_at, prd_snapshot, plans_created)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        "run-newer",
        projectId,
        "2025-01-02T00:00:00Z",
        JSON.stringify(prdContent),
        JSON.stringify(["plan-2"]),
      ]
    );

    const app = createApp();
    const statusRes = await request(app).get(`${API_PREFIX}/projects/${projectId}/plan-status`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.hasPlanningRun).toBe(true);
    expect(statusRes.body.data.action).toBe("none");
  });
});
