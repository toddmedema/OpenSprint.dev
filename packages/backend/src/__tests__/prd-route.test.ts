import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createApp } from "../app.js";
import { ProjectService } from "../services/project.service.js";
import { API_PREFIX, DEFAULT_HIL_CONFIG, SPEC_MD, prdToSpecMarkdown } from "@opensprint/shared";
import { cleanupTestProject } from "./test-project-cleanup.js";
import {
  pinOpenSprintPathsForTesting,
  resetOpenSprintPathsForTesting,
} from "./opensprint-path-test-helper.js";
import { authedSupertest } from "./local-auth-test-helpers.js";

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => [a, b],
}));
vi.mock("../db/drizzle-schema-pg.js", () => ({ plansTable: {} }));

// Mock TaskStoreService so tests don't require bd CLI or shell
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

const prdTaskStoreMod = await import("../services/task-store.service.js");
const prdPostgresOk =
  (prdTaskStoreMod as { _postgresAvailable?: boolean })._postgresAvailable ?? false;

vi.mock("../websocket/index.js", () => ({
  broadcastToProject: vi.fn(),
}));

const mockInvokePlanningAgent = vi.fn();
vi.mock("../services/agent.service.js", () => ({
  agentService: {
    invokePlanningAgent: (...args: unknown[]) => mockInvokePlanningAgent(...args),
  },
}));

describe.skipIf(!prdPostgresOk)("PRD REST API", () => {
  let app: ReturnType<typeof createApp>;
  let projectService: ProjectService;
  let tempDir: string;
  let projectId: string;

  afterAll(async () => {
    const mod = (await import("../services/task-store.service.js")) as {
      _testPool?: { end: () => Promise<void> };
    };
    if (mod._testPool) await mod._testPool.end();
  });

  beforeEach(async () => {
    const taskStoreMod = (await import("../services/task-store.service.js")) as unknown as {
      _resetSharedDb?: () => void | Promise<void>;
    };
    await taskStoreMod._resetSharedDb?.();

    app = createApp();
    projectService = new ProjectService();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opensprint-prd-route-test-"));
    pinOpenSprintPathsForTesting(tempDir);

    const project = await projectService.createProject({
      name: "Test Project",
      repoPath: path.join(tempDir, "my-project"),
      simpleComplexityAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
      complexComplexityAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
      deployment: { mode: "custom" },
      hilConfig: DEFAULT_HIL_CONFIG,
    });
    projectId = project.id;
  });

  afterEach(async () => {
    await cleanupTestProject({ projectService, projectId });
    projectService.clearListCacheForTesting();
    resetOpenSprintPathsForTesting();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore ENOTEMPTY and similar on some systems when removing .git
    }
  });

  it("GET /projects/:id/prd should return full PRD", async () => {
    const res = await authedSupertest(app).get(`${API_PREFIX}/projects/${projectId}/prd`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.version).toBeDefined();
    expect(res.body.data.sections).toBeDefined();
    expect(res.body.data.sections.executive_summary).toBeDefined();
    expect(res.body.data.sections.problem_statement).toBeDefined();
    expect(res.body.data.changeLog).toEqual([]);
  });

  it("GET /projects/:id/prd should return 404 when project not found", async () => {
    const res = await authedSupertest(app).get(`${API_PREFIX}/projects/nonexistent-id/prd`);

    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe("PROJECT_NOT_FOUND");
  });

  it("GET /projects/:id/prd/history should return empty change log when no changes", async () => {
    const res = await authedSupertest(app).get(`${API_PREFIX}/projects/${projectId}/prd/history`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("GET /projects/:id/prd/history should return change log after updates", async () => {
    await authedSupertest(app)
      .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
      .send({ content: "Updated summary" });

    const res = await authedSupertest(app).get(`${API_PREFIX}/projects/${projectId}/prd/history`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].section).toBe("executive_summary");
    expect(res.body.data[0].version).toBe(1);
    expect(res.body.data[0].source).toBe("sketch");
    expect(res.body.data[0].documentVersion).toBe(1);
    expect(res.body.data[0].timestamp).toBeDefined();
    expect(res.body.data[0].diff).toBeDefined();
  });

  describe("GET /projects/:id/prd/diff", () => {
    it("returns diff between fromVersion and current after PRD update", async () => {
      await authedSupertest(app)
        .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
        .send({ content: "First version" });

      await authedSupertest(app)
        .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
        .send({ content: "Second version" });

      const res = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/diff?fromVersion=1`
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.fromVersion).toBe("1");
      expect(res.body.data.toVersion).toBe("current");
      expect(typeof res.body.data.fromContent).toBe("string");
      expect(typeof res.body.data.toContent).toBe("string");
      expect(res.body.data.fromContent).toContain("First version");
      expect(res.body.data.toContent).toContain("Second version");
      expect(res.body.data.diff).toBeDefined();
      expect(res.body.data.diff.lines).toBeDefined();
      expect(Array.isArray(res.body.data.diff.lines)).toBe(true);
      for (const line of res.body.data.diff.lines) {
        expect(["add", "remove", "context"]).toContain(line.type);
        expect(typeof line.text).toBe("string");
      }
      expect(res.body.data.diff.summary).toBeDefined();
      expect(typeof res.body.data.diff.summary.additions).toBe("number");
      expect(typeof res.body.data.diff.summary.deletions).toBe("number");
    });

    it("returns 404 when fromVersion has no snapshot", async () => {
      const res = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/diff?fromVersion=99`
      );

      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe("NOT_FOUND");
      expect(res.body.error?.message).toContain("99");
    });

    it("returns 400 when fromVersion is missing", async () => {
      const res = await authedSupertest(app).get(`${API_PREFIX}/projects/${projectId}/prd/diff`);

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION_ERROR");
      expect(res.body.error?.message).toMatch(/fromVersion|number|NaN/i);
    });

    it("returns 400 when fromVersion is not a valid integer", async () => {
      const res = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/diff?fromVersion=abc`
      );

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION_ERROR");
    });

    it("returns 200 with no add/remove lines when from and to are identical (same snapshot)", async () => {
      await authedSupertest(app)
        .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
        .send({ content: "Stable body" });

      const res = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/diff?fromVersion=1&toVersion=1`
      );

      expect(res.status).toBe(200);
      expect(res.body.data.fromVersion).toBe("1");
      expect(res.body.data.toVersion).toBe("1");
      expect(res.body.data.fromContent).toBe(res.body.data.toContent);
      expect(res.body.data.diff.summary.additions).toBe(0);
      expect(res.body.data.diff.summary.deletions).toBe(0);
      expect(res.body.data.diff.lines.every((l: { type: string }) => l.type === "context")).toBe(
        true
      );
    });

    it("returns 404 when toVersion snapshot is missing", async () => {
      await authedSupertest(app)
        .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
        .send({ content: "Only v1" });

      const res = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/diff?fromVersion=1&toVersion=5`
      );

      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe("NOT_FOUND");
      expect(res.body.error?.message).toContain("5");
    });

    it("treats omitted toVersion like current (same as explicit current)", async () => {
      await authedSupertest(app)
        .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
        .send({ content: "Once" });

      const omitted = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/diff?fromVersion=1`
      );
      const explicit = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/diff?fromVersion=1&toVersion=current`
      );

      expect(omitted.status).toBe(200);
      expect(explicit.status).toBe(200);
      expect(omitted.body.data.toVersion).toBe("current");
      expect(explicit.body.data.toVersion).toBe("current");
      expect(omitted.body.data.toContent).toBe(explicit.body.data.toContent);
    });

    it("includes fromContent and toContent by default (includeContent omitted)", async () => {
      await authedSupertest(app)
        .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
        .send({ content: "Content v1" });

      const res = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/diff?fromVersion=1`
      );

      expect(res.status).toBe(200);
      expect(typeof res.body.data.fromContent).toBe("string");
      expect(typeof res.body.data.toContent).toBe("string");
    });

    it("includes fromContent and toContent when includeContent=true", async () => {
      await authedSupertest(app)
        .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
        .send({ content: "Content v1" });

      const res = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/diff?fromVersion=1&includeContent=true`
      );

      expect(res.status).toBe(200);
      expect(typeof res.body.data.fromContent).toBe("string");
      expect(typeof res.body.data.toContent).toBe("string");
    });

    it("omits fromContent and toContent when includeContent=false", async () => {
      await authedSupertest(app)
        .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
        .send({ content: "Content v1" });

      await authedSupertest(app)
        .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
        .send({ content: "Content v2" });

      const res = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/diff?fromVersion=1&includeContent=false`
      );

      expect(res.status).toBe(200);
      expect(res.body.data.fromContent).toBeUndefined();
      expect(res.body.data.toContent).toBeUndefined();
      expect(res.body.data.fromVersion).toBe("1");
      expect(res.body.data.toVersion).toBe("current");
      expect(res.body.data.diff).toBeDefined();
      expect(res.body.data.diff.lines).toBeDefined();
      expect(Array.isArray(res.body.data.diff.lines)).toBe(true);
      expect(res.body.data.diff.summary).toBeDefined();
      expect(res.body.data.diff.summary.additions).toBeGreaterThan(0);
    });

    it("accepts includeContent=0 as false", async () => {
      await authedSupertest(app)
        .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
        .send({ content: "Content v1" });

      const res = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/diff?fromVersion=1&includeContent=0`
      );

      expect(res.status).toBe(200);
      expect(res.body.data.fromContent).toBeUndefined();
      expect(res.body.data.toContent).toBeUndefined();
      expect(res.body.data.diff).toBeDefined();
    });

    it("accepts includeContent=1 as true", async () => {
      await authedSupertest(app)
        .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
        .send({ content: "Content v1" });

      const res = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/diff?fromVersion=1&includeContent=1`
      );

      expect(res.status).toBe(200);
      expect(typeof res.body.data.fromContent).toBe("string");
      expect(typeof res.body.data.toContent).toBe("string");
    });

    it("still returns diff lines even when includeContent=false with toVersion", async () => {
      await authedSupertest(app)
        .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
        .send({ content: "Snapshot A" });

      await authedSupertest(app)
        .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
        .send({ content: "Snapshot B" });

      const res = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/diff?fromVersion=1&toVersion=2&includeContent=false`
      );

      expect(res.status).toBe(200);
      expect(res.body.data.fromContent).toBeUndefined();
      expect(res.body.data.toContent).toBeUndefined();
      expect(res.body.data.fromVersion).toBe("1");
      expect(res.body.data.toVersion).toBe("2");
      expect(res.body.data.diff.lines.length).toBeGreaterThan(0);
    });
  });

  describe("GET /projects/:id/prd/proposed-diff", () => {
    it("returns 200 and diff when hil_approval notification has scopeChangeMetadata", async () => {
      await authedSupertest(app)
        .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
        .send({ content: "Current content" });

      const { notificationService } = await import("../services/notification.service.js");
      const notif = await notificationService.createHilApproval({
        projectId,
        source: "eval",
        sourceId: "fb-1",
        description: "Approve scope change?",
        category: "scopeChanges",
        scopeChangeMetadata: {
          scopeChangeSummary: "Update executive summary",
          scopeChangeProposedUpdates: [
            {
              section: "executive_summary",
              changeLogEntry: "Proposed update",
              content: "Proposed content",
            },
          ],
        },
      });

      const res = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/proposed-diff?requestId=${notif.id}`
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.requestId).toBe(notif.id);
      expect(typeof res.body.data.fromContent).toBe("string");
      expect(typeof res.body.data.toContent).toBe("string");
      expect(res.body.data.fromContent).toContain("Current content");
      expect(res.body.data.toContent).toContain("Proposed content");
      expect(res.body.data.diff).toBeDefined();
      expect(res.body.data.diff.lines).toBeDefined();
      expect(Array.isArray(res.body.data.diff.lines)).toBe(true);
      for (const line of res.body.data.diff.lines) {
        expect(["add", "remove", "context"]).toContain(line.type);
        expect(typeof line.text).toBe("string");
      }
      expect(res.body.data.diff.summary).toBeDefined();
      expect(typeof res.body.data.diff.summary.additions).toBe("number");
      expect(typeof res.body.data.diff.summary.deletions).toBe("number");
    });

    it("returns 404 for invalid requestId", async () => {
      const res = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/proposed-diff?requestId=hil-nonexistent`
      );

      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe("NOT_FOUND");
    });

    it("returns 404 when requestId refers to non-hil_approval notification", async () => {
      const { notificationService } = await import("../services/notification.service.js");
      const openQuestion = await notificationService.create({
        projectId,
        source: "plan",
        sourceId: "test-1",
        questions: [{ id: "q1", text: "Clarification?" }],
      });

      const res = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/proposed-diff?requestId=${openQuestion.id}`
      );

      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe("NOT_FOUND");
      expect(res.body.error?.message).toContain("not found");
    });

    it("returns 400 when requestId is missing", async () => {
      const res = await authedSupertest(app).get(`${API_PREFIX}/projects/${projectId}/prd/proposed-diff`);

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION_ERROR");
      expect(res.body.error?.message).toMatch(/requestId|string|undefined/i);
    });

    it("omits fromContent and toContent when includeContent=false", async () => {
      await authedSupertest(app)
        .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
        .send({ content: "Current content" });

      const { notificationService } = await import("../services/notification.service.js");
      const notif = await notificationService.createHilApproval({
        projectId,
        source: "eval",
        sourceId: "fb-2",
        description: "Approve scope change?",
        category: "scopeChanges",
        scopeChangeMetadata: {
          scopeChangeSummary: "Update executive summary",
          scopeChangeProposedUpdates: [
            {
              section: "executive_summary",
              changeLogEntry: "Proposed update",
              content: "Proposed content for slim test",
            },
          ],
        },
      });

      const res = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/proposed-diff?requestId=${notif.id}&includeContent=false`
      );

      expect(res.status).toBe(200);
      expect(res.body.data.requestId).toBe(notif.id);
      expect(res.body.data.fromContent).toBeUndefined();
      expect(res.body.data.toContent).toBeUndefined();
      expect(res.body.data.diff).toBeDefined();
      expect(res.body.data.diff.lines).toBeDefined();
      expect(Array.isArray(res.body.data.diff.lines)).toBe(true);
      expect(res.body.data.diff.summary).toBeDefined();
    });

    it("includes content by default in proposed-diff", async () => {
      await authedSupertest(app)
        .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
        .send({ content: "Current content" });

      const { notificationService } = await import("../services/notification.service.js");
      const notif = await notificationService.createHilApproval({
        projectId,
        source: "eval",
        sourceId: "fb-3",
        description: "Approve scope change?",
        category: "scopeChanges",
        scopeChangeMetadata: {
          scopeChangeSummary: "Update executive summary",
          scopeChangeProposedUpdates: [
            {
              section: "executive_summary",
              changeLogEntry: "Proposed update",
              content: "Proposed content default",
            },
          ],
        },
      });

      const res = await authedSupertest(app).get(
        `${API_PREFIX}/projects/${projectId}/prd/proposed-diff?requestId=${notif.id}`
      );

      expect(res.status).toBe(200);
      expect(typeof res.body.data.fromContent).toBe("string");
      expect(typeof res.body.data.toContent).toBe("string");
    });
  });

  it("GET /projects/:id/prd/:section should return specific section", async () => {
    const repoPath = path.join(tempDir, "my-project");
    const prd = {
      version: 0,
      sections: {
        executive_summary: {
          content: "Our product solves X",
          version: 1,
          updatedAt: new Date().toISOString(),
        },
        problem_statement: { content: "", version: 0, updatedAt: new Date().toISOString() },
        user_personas: { content: "", version: 0, updatedAt: new Date().toISOString() },
        goals_and_metrics: { content: "", version: 0, updatedAt: new Date().toISOString() },
        assumptions_and_constraints: {
          content: "",
          version: 0,
          updatedAt: new Date().toISOString(),
        },
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
    await fs.writeFile(path.join(repoPath, SPEC_MD), prdToSpecMarkdown(prd as never), "utf-8");
    // Do not write legacy spec-metadata.json: PrdService reads metadata from DB; if no row
    // and legacy file exists, assertMigrationCompleteForResource throws.

    const res = await authedSupertest(app).get(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`);

    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe("Our product solves X");
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.updatedAt).toBeDefined();
  });

  it("GET /projects/:id/prd/:section should return 404 when project not found", async () => {
    const res = await authedSupertest(app).get(
      `${API_PREFIX}/projects/nonexistent-id/prd/executive_summary`
    );

    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe("PROJECT_NOT_FOUND");
  });

  it("GET /projects/:id/prd/:section should return 400 for invalid section key", async () => {
    const res = await authedSupertest(app).get(`${API_PREFIX}/projects/${projectId}/prd/InvalidSection`);

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("INVALID_SECTION");
  });

  it("PUT /projects/:id/prd/:section should update section and return version info", async () => {
    const res = await authedSupertest(app)
      .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
      .send({ content: "New executive summary content" });

    expect(res.status).toBe(200);
    expect(res.body.data.section.content).toBe("New executive summary content");
    expect(res.body.data.section.version).toBe(1);
    expect(res.body.data.previousVersion).toBe(0);
    expect(res.body.data.newVersion).toBe(1);

    const getRes = await authedSupertest(app).get(
      `${API_PREFIX}/projects/${projectId}/prd/executive_summary`
    );
    expect(getRes.body.data.content).toBe("New executive summary content");
  });

  it("PUT /projects/:id/prd/:section should accept source parameter", async () => {
    const res = await authedSupertest(app)
      .put(`${API_PREFIX}/projects/${projectId}/prd/problem_statement`)
      .send({ content: "Users face challenges", source: "plan" });

    expect(res.status).toBe(200);
    expect(res.body.data.newVersion).toBe(1);

    const historyRes = await authedSupertest(app).get(`${API_PREFIX}/projects/${projectId}/prd/history`);
    expect(historyRes.body.data[0].source).toBe("plan");
  });

  it("PUT /projects/:id/prd/:section should return 404 when project not found", async () => {
    const res = await authedSupertest(app)
      .put(`${API_PREFIX}/projects/nonexistent-id/prd/executive_summary`)
      .send({ content: "Some content" });

    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe("PROJECT_NOT_FOUND");
  });

  it("PUT /projects/:id/prd/:section should return 400 for invalid section key", async () => {
    const res = await authedSupertest(app)
      .put(`${API_PREFIX}/projects/${projectId}/prd/InvalidSection`)
      .send({ content: "Some content" });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("INVALID_SECTION");
  });

  it("PUT /projects/:id/prd/:section should return 400 when content is missing", async () => {
    const res = await authedSupertest(app)
      .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("PUT /projects/:id/prd/:section should allow empty string content", async () => {
    const res = await authedSupertest(app)
      .put(`${API_PREFIX}/projects/${projectId}/prd/executive_summary`)
      .send({ content: "" });

    expect(res.status).toBe(200);
    expect(res.body.data.section.content).toBe("");
  });

  it("POST /projects/:id/prd/upload should extract text from .md file for empty-state onboarding", async () => {
    const mdContent = "# My Product PRD\n\n## Overview\n\nA task management app.";
    const buffer = Buffer.from(mdContent, "utf-8");

    const res = await authedSupertest(app)
      .post(`${API_PREFIX}/projects/${projectId}/prd/upload`)
      .attach("file", buffer, "spec.md");

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.text).toBe(mdContent);
    expect(res.body.data.filename).toBe("spec.md");
  });

  it("POST /projects/:id/prd/upload should return 400 when no file provided", async () => {
    const res = await authedSupertest(app).post(`${API_PREFIX}/projects/${projectId}/prd/upload`);

    expect(res.status).toBe(400);
    expect(res.body.error?.message).toContain("No file");
  });

  it("POST /projects/:id/prd/upload should return 400 for unsupported file type", async () => {
    const buffer = Buffer.from("content", "utf-8");

    const res = await authedSupertest(app)
      .post(`${API_PREFIX}/projects/${projectId}/prd/upload`)
      .attach("file", buffer, "document.txt");

    expect(res.status).toBe(400);
    expect(res.body.error?.message).toContain("Unsupported");
  });

  describe("POST /projects/:id/prd/generate-from-codebase", () => {
    beforeEach(() => {
      mockInvokePlanningAgent.mockReset();
    });

    it("returns 204 and updates PRD when agent returns PRD_UPDATE blocks", async () => {
      const repoPath = path.join(tempDir, "my-project");
      await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
      await fs.writeFile(path.join(repoPath, "src", "index.ts"), "export function main() {}");

      const prdUpdateContent = "This app is a small TypeScript module.";
      mockInvokePlanningAgent.mockResolvedValue({
        content: `[PRD_UPDATE:executive_summary]\n${prdUpdateContent}\n[/PRD_UPDATE]`,
      });

      const res = await authedSupertest(app).post(
        `${API_PREFIX}/projects/${projectId}/prd/generate-from-codebase`
      );

      expect(res.status).toBe(204);
      expect(mockInvokePlanningAgent).toHaveBeenCalled();

      const prdRes = await authedSupertest(app).get(`${API_PREFIX}/projects/${projectId}/prd`);
      expect(prdRes.status).toBe(200);
      expect(prdRes.body.data.sections.executive_summary?.content).toBe(prdUpdateContent);
    });

    it("returns 400 when agent returns no PRD_UPDATE blocks", async () => {
      const repoPath = path.join(tempDir, "my-project");
      await fs.writeFile(path.join(repoPath, "main.py"), "print('hi')");

      mockInvokePlanningAgent.mockResolvedValue({ content: "I could not infer a PRD." });

      const res = await authedSupertest(app).post(
        `${API_PREFIX}/projects/${projectId}/prd/generate-from-codebase`
      );

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("INVALID_INPUT");
    });
  });
});
