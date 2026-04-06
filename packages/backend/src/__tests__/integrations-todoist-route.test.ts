import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createApp } from "../app.js";
import { ProjectService } from "../services/project.service.js";
import { integrationStore } from "../services/integration-store.service.js";
import { tokenEncryption } from "../services/token-encryption.service.js";
import { taskStore } from "../services/task-store.service.js";
import { API_PREFIX, DEFAULT_HIL_CONFIG } from "@opensprint/shared";
import { authedSupertest } from "./local-auth-test-helpers.js";
import { cleanupTestProject } from "./test-project-cleanup.js";
import {
  pinOpenSprintPathsForTesting,
  resetOpenSprintPathsForTesting,
} from "./opensprint-path-test-helper.js";
import { oauthStateStore } from "../routes/integrations-todoist.js";

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => [a, b],
}));
vi.mock("../db/drizzle-schema-pg.js", () => ({ plansTable: {} }));

vi.mock("../services/task-store.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/task-store.service.js")>();
  const { createTestPostgresClient } = await import("./test-db-helper.js");
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
  return {
    ...actual,
    TaskStoreService: class extends actual.TaskStoreService {
      constructor() {
        super(dbResult.client);
      }
    },
    taskStore: store,
    _postgresAvailable: true,
  };
});

const todoistRouteTaskStoreMod = await import("../services/task-store.service.js");
const postgresOk =
  (todoistRouteTaskStoreMod as { _postgresAvailable?: boolean })._postgresAvailable ?? false;

vi.mock("../services/agent-client.js", () => ({
  AgentClient: vi.fn().mockImplementation(() => ({
    invoke: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        category: "feature",
        mappedPlanId: null,
        task_titles: ["Mock task"],
      }),
    }),
  })),
}));

vi.mock("../services/hil-service.js", () => ({
  hilService: { evaluateDecision: vi.fn().mockResolvedValue({ approved: false }) },
}));

vi.mock("../websocket/index.js", () => ({
  broadcastToProject: vi.fn(),
}));

vi.mock("../services/deploy-trigger.service.js", () => ({
  triggerDeploy: vi.fn().mockResolvedValue("deploy-123"),
  triggerDeployForEvent: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/todoist-api-client.service.js", async () => {
  const { createTodoistApiClientVitestMock } = await import(
    "./mocks/todoist-api-client.service.vitest-mock.js"
  );
  return createTodoistApiClientVitestMock();
});

const mockedTodoistService = await import("../services/todoist-api-client.service.js");

const BASE = `${API_PREFIX}/projects`;
function todoistUrl(projectId: string, route = "") {
  return `${BASE}/${projectId}/integrations/todoist${route}`;
}

async function seedConnection(
  projectId: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  const realEncryptedToken = tokenEncryption.encryptToken("test-access-token");
  const defaults = {
    project_id: projectId,
    provider: "todoist" as const,
    provider_user_id: "todoist-user",
    provider_user_email: "user@todoist.test",
    access_token_enc: realEncryptedToken,
    scopes: "data:read_write,data:delete",
    status: "active" as const,
  };
  await integrationStore.upsertConnection({ ...defaults, ...overrides });
}

async function cleanIntegrationData(projectId: string): Promise<void> {
  try {
    await integrationStore.deleteConnection(projectId, "todoist");
  } catch {
    // ignore if not present
  }
  const db = await taskStore.getDb();
  await db.execute(
    "DELETE FROM integration_import_ledger WHERE project_id = $1 AND provider = $2",
    [projectId, "todoist"]
  );
}

describe.skipIf(!postgresOk)("Todoist Integration Routes (createApp)", () => {
  let app: ReturnType<typeof createApp>;
  let projectService: ProjectService;
  let tempDir: string;
  let projectId: string;

  beforeEach(async () => {
    app = createApp();
    projectService = new ProjectService();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opensprint-todoist-route-test-"));
    pinOpenSprintPathsForTesting(tempDir);

    const project = await projectService.createProject({
      name: "Todoist Test Project",
      repoPath: path.join(tempDir, "my-project"),
      simpleComplexityAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
      complexComplexityAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
      deployment: { mode: "custom" },
      hilConfig: DEFAULT_HIL_CONFIG,
    });
    projectId = project.id;
    await taskStore.init();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await cleanIntegrationData(projectId);
    oauthStateStore.destroy();
    await cleanupTestProject({ projectService, projectId });
    projectService.clearListCacheForTesting();
    resetOpenSprintPathsForTesting();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // ─── POST /oauth/start ───

  describe("POST /oauth/start", () => {
    it("returns 200 with authorizationUrl containing client_id and scopes", async () => {
      const res = await authedSupertest(app)
        .post(todoistUrl(projectId, "/oauth/start"))
        .expect(200);

      expect(res.body.data.authorizationUrl).toContain("client_id=test-client-id");
      expect(res.body.data.authorizationUrl).toContain("data%3Aread_write");
      expect(res.body.data.authorizationUrl).toContain("data%3Adelete");
      expect(mockedTodoistService.generateOAuthState).toHaveBeenCalled();
      expect(mockedTodoistService.buildAuthorizationUrl).toHaveBeenCalledWith(
        "test-client-id",
        ["data:read_write", "data:delete"],
        "mock-state-token"
      );
    });

  });

  // ─── GET /oauth/callback ───

  describe("GET /oauth/callback", () => {
    it("exchanges code for token, creates connection, and returns JSON for API clients", async () => {
      oauthStateStore.store("valid-cb-state", projectId);

      const res = await authedSupertest(app)
        .get(todoistUrl(projectId, "/oauth/callback"))
        .query({ code: "auth-code-xyz", state: "valid-cb-state" })
        .set("Accept", "application/json")
        .expect(200);

      expect(res.body.data.success).toBe(true);
      expect(res.body.data.projectId).toBe(projectId);

      expect(mockedTodoistService.exchangeCodeForToken).toHaveBeenCalledWith(
        "test-client-id",
        "test-client-secret",
        "auth-code-xyz"
      );

      const conn = await integrationStore.getConnection(projectId, "todoist");
      expect(conn).not.toBeNull();
      expect(conn!.status).toBe("active");
      expect(conn!.scopes).toBe("data:read_write,data:delete");
    });

    it("returns 400 for invalid state token", async () => {
      const res = await authedSupertest(app)
        .get(todoistUrl(projectId, "/oauth/callback"))
        .query({ code: "auth-code-xyz", state: "bogus-state" })
        .set("Accept", "application/json")
        .expect(400);

      expect(res.body.error.code).toBe("INVALID_OAUTH_STATE");
    });

  });

  // ─── GET /status ───

  describe("GET /status", () => {
    it("returns full status object without tokens when actively connected", async () => {
      await seedConnection(projectId, {
        provider_resource_id: "tp-1",
        provider_resource_name: "Inbox",
      });
      await integrationStore.updateLastSync(
        (await integrationStore.getConnection(projectId, "todoist"))!.id,
        "2025-06-01T12:00:00.000Z"
      );

      const res = await authedSupertest(app).get(todoistUrl(projectId, "/status")).expect(200);

      expect(res.body.data.connected).toBe(true);
      expect(res.body.data.status).toBe("active");
      expect(res.body.data.todoistUser).toEqual({
        id: "todoist-user",
        email: "user@todoist.test",
      });
      expect(res.body.data.selectedProject).toEqual({
        id: "tp-1",
        name: "Inbox",
      });
      expect(res.body.data.lastSyncAt).toBe("2025-06-01T12:00:00.000Z");

      const body = JSON.stringify(res.body);
      expect(body).not.toContain("access_token");
      expect(body).not.toContain("encrypted");
    });
  });

  // ─── GET /projects ───

  describe("GET /projects", () => {
    it("returns project list from mocked Todoist SDK", async () => {
      await seedConnection(projectId);

      const res = await authedSupertest(app).get(todoistUrl(projectId, "/projects")).expect(200);

      expect(res.body.data.projects).toEqual([
        { id: "tp-1", name: "Inbox" },
        { id: "tp-2", name: "Work" },
      ]);
    });

    it("returns 401 and sets needs_reconnect on auth error", async () => {
      const { TodoistAuthError } = mockedTodoistService;
      vi.mocked(mockedTodoistService.TodoistApiClient).mockImplementationOnce(
        () =>
          ({
            getProjects: vi.fn().mockRejectedValue(new TodoistAuthError("token revoked", 401)),
          }) as ReturnType<typeof mockedTodoistService.TodoistApiClient>
      );

      await seedConnection(projectId);

      const res = await authedSupertest(app).get(todoistUrl(projectId, "/projects")).expect(401);

      expect(res.body.error.code).toBe("TODOIST_AUTH_FAILED");

      const conn = await integrationStore.getConnection(projectId, "todoist");
      expect(conn!.status).toBe("needs_reconnect");
    });
  });

  // ─── PUT /project ───

  describe("PUT /project", () => {
    it("saves selection and returns 200 for valid project ID", async () => {
      await seedConnection(projectId);

      const res = await authedSupertest(app)
        .put(todoistUrl(projectId, "/project"))
        .send({ todoistProjectId: "tp-1" })
        .expect(200);

      expect(res.body.data).toEqual({
        success: true,
        selectedProject: { id: "tp-1", name: "Inbox" },
      });

      const conn = await integrationStore.getConnection(projectId, "todoist");
      expect(conn!.provider_resource_id).toBe("tp-1");
      expect(conn!.provider_resource_name).toBe("Inbox");
    });

  });

  // ─── POST /sync ───

  describe("POST /sync", () => {
    it("returns 500 when sync service is not configured (createApp default)", async () => {
      await seedConnection(projectId);

      const res = await authedSupertest(app).post(todoistUrl(projectId, "/sync")).expect(500);

      expect(res.body.error.code).toBe("SYNC_NOT_AVAILABLE");
    });
  });

  // ─── DELETE / ───

  describe("DELETE /", () => {
    it("disconnects, revokes token, and returns success", async () => {
      await seedConnection(projectId);

      const res = await authedSupertest(app).delete(todoistUrl(projectId, "")).expect(200);

      expect(res.body.data.disconnected).toBe(true);
      expect(mockedTodoistService.revokeAccessToken).toHaveBeenCalled();

      const conn = await integrationStore.getConnection(projectId, "todoist");
      expect(conn).toBeNull();
    });

  });
});
