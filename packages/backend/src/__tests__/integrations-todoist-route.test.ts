import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createApp } from "../app.js";
import { ProjectService } from "../services/project.service.js";
import { integrationStore } from "../services/integration-store.service.js";
import { tokenEncryption } from "../services/token-encryption.service.js";
import { taskStore } from "../services/task-store.service.js";
import { API_PREFIX, DEFAULT_HIL_CONFIG } from "@opensprint/shared";
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

vi.mock("../services/todoist-api-client.service.js", () => {
  class _TodoistAuthError extends Error {
    override name = "TodoistAuthError" as const;
    constructor(
      message: string,
      public readonly httpStatusCode: number
    ) {
      super(message);
    }
  }

  class _TodoistRateLimitError extends Error {
    override name = "TodoistRateLimitError" as const;
    constructor(
      message: string,
      public readonly retryAfter: number
    ) {
      super(message);
    }
  }

  return {
    generateOAuthState: vi.fn().mockReturnValue("mock-state-token"),
    buildAuthorizationUrl: vi
      .fn()
      .mockReturnValue(
        "https://app.todoist.com/oauth/authorize?client_id=test-client-id&scope=data%3Aread_write%2Cdata%3Adelete&state=mock-state-token"
      ),
    exchangeCodeForToken: vi.fn().mockResolvedValue({
      accessToken: "tok-abc-123",
      tokenType: "Bearer",
    }),
    revokeAccessToken: vi.fn().mockResolvedValue(true),
    getTodoistOAuthConfig: vi.fn().mockReturnValue({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      redirectUri:
        "http://localhost:3000/api/v1/projects/proj-1/integrations/todoist/oauth/callback",
    }),
    TodoistApiClient: vi.fn().mockImplementation(() => ({
      getProjects: vi.fn().mockResolvedValue([
        { id: "tp-1", name: "Inbox" },
        { id: "tp-2", name: "Work" },
      ]),
    })),
    TodoistAuthError: _TodoistAuthError,
    TodoistRateLimitError: _TodoistRateLimitError,
  };
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
      const res = await request(app).post(todoistUrl(projectId, "/oauth/start")).expect(200);

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

    it("returns 500 when Todoist env vars are not configured", async () => {
      vi.mocked(mockedTodoistService.getTodoistOAuthConfig).mockImplementationOnce(() => {
        throw new Error("Missing config");
      });

      const res = await request(app).post(todoistUrl(projectId, "/oauth/start")).expect(500);

      expect(res.body.error.code).toBe("INTEGRATION_NOT_CONFIGURED");
    });
  });

  // ─── GET /oauth/callback ───

  describe("GET /oauth/callback", () => {
    it("exchanges code for token, creates connection, and returns JSON for API clients", async () => {
      oauthStateStore.store("valid-cb-state", projectId);

      const res = await request(app)
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

    it("redirects browser clients to settings page on success", async () => {
      oauthStateStore.store("browser-cb-state", projectId);

      const res = await request(app)
        .get(todoistUrl(projectId, "/oauth/callback"))
        .query({ code: "auth-code-xyz", state: "browser-cb-state" })
        .set("Accept", "text/html")
        .expect(302);

      expect(res.headers.location).toContain(`/projects/${projectId}/settings`);
      expect(res.headers.location).toContain("integration=todoist");
      expect(res.headers.location).toContain("status=success");
    });

    it("returns 400 for invalid state token", async () => {
      const res = await request(app)
        .get(todoistUrl(projectId, "/oauth/callback"))
        .query({ code: "auth-code-xyz", state: "bogus-state" })
        .set("Accept", "application/json")
        .expect(400);

      expect(res.body.error.code).toBe("INVALID_OAUTH_STATE");
    });

    it("returns 400 for expired state token", async () => {
      oauthStateStore.store("expired-cb-state", projectId);
      oauthStateStore.forceExpireForTest("expired-cb-state");

      const res = await request(app)
        .get(todoistUrl(projectId, "/oauth/callback"))
        .query({ code: "auth-code-xyz", state: "expired-cb-state" })
        .set("Accept", "application/json")
        .expect(400);

      expect(res.body.error.code).toBe("INVALID_OAUTH_STATE");
    });

    it("returns 400 when code query param is missing", async () => {
      const res = await request(app)
        .get(todoistUrl(projectId, "/oauth/callback"))
        .query({ state: "some-state" })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it("returns 400 when state query param is missing", async () => {
      const res = await request(app)
        .get(todoistUrl(projectId, "/oauth/callback"))
        .query({ code: "some-code" })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });
  });

  // ─── GET /status ───

  describe("GET /status", () => {
    it("returns connected: false when no connection exists", async () => {
      const res = await request(app).get(todoistUrl(projectId, "/status")).expect(200);

      expect(res.body.data).toEqual({ connected: false, status: "disabled" });
    });

    it("returns full status object without tokens when actively connected", async () => {
      await seedConnection(projectId, {
        provider_resource_id: "tp-1",
        provider_resource_name: "Inbox",
      });
      await integrationStore.updateLastSync(
        (await integrationStore.getConnection(projectId, "todoist"))!.id,
        "2025-06-01T12:00:00.000Z"
      );

      const res = await request(app).get(todoistUrl(projectId, "/status")).expect(200);

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

      const res = await request(app).get(todoistUrl(projectId, "/projects")).expect(200);

      expect(res.body.data.projects).toEqual([
        { id: "tp-1", name: "Inbox" },
        { id: "tp-2", name: "Work" },
      ]);
    });

    it("returns 404 when not connected", async () => {
      const res = await request(app).get(todoistUrl(projectId, "/projects")).expect(404);

      expect(res.body.error.code).toBe("NOT_CONNECTED");
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

      const res = await request(app).get(todoistUrl(projectId, "/projects")).expect(401);

      expect(res.body.error.code).toBe("TODOIST_AUTH_FAILED");

      const conn = await integrationStore.getConnection(projectId, "todoist");
      expect(conn!.status).toBe("needs_reconnect");
    });
  });

  // ─── PUT /project ───

  describe("PUT /project", () => {
    it("saves selection and returns 200 for valid project ID", async () => {
      await seedConnection(projectId);

      const res = await request(app)
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

    it("returns 400 for invalid project ID not in user's list", async () => {
      await seedConnection(projectId);

      const res = await request(app)
        .put(todoistUrl(projectId, "/project"))
        .send({ todoistProjectId: "nonexistent-proj" })
        .expect(400);

      expect(res.body.error.code).toBe("PROJECT_NOT_FOUND");
    });

    it("returns 404 when not connected", async () => {
      const res = await request(app)
        .put(todoistUrl(projectId, "/project"))
        .send({ todoistProjectId: "tp-1" })
        .expect(404);

      expect(res.body.error.code).toBe("NOT_CONNECTED");
    });
  });

  // ─── POST /sync ───

  describe("POST /sync", () => {
    it("returns 404 when not connected", async () => {
      const res = await request(app).post(todoistUrl(projectId, "/sync")).expect(404);

      expect(res.body.error.code).toBe("NOT_CONNECTED");
    });

    it("returns 429 when sync triggered within 10 seconds", async () => {
      await seedConnection(projectId);
      const conn = await integrationStore.getConnection(projectId, "todoist");
      await integrationStore.updateLastSync(conn!.id, new Date(Date.now() - 3000).toISOString());

      const res = await request(app).post(todoistUrl(projectId, "/sync")).expect(429);

      expect(res.body.error.code).toBe("SYNC_RATE_LIMITED");
    });

    it("returns 500 when sync service is not configured (createApp default)", async () => {
      await seedConnection(projectId);

      const res = await request(app).post(todoistUrl(projectId, "/sync")).expect(500);

      expect(res.body.error.code).toBe("SYNC_NOT_AVAILABLE");
    });
  });

  // ─── DELETE / ───

  describe("DELETE /", () => {
    it("disconnects, revokes token, and returns success", async () => {
      await seedConnection(projectId);

      const res = await request(app).delete(todoistUrl(projectId, "")).expect(200);

      expect(res.body.data.disconnected).toBe(true);
      expect(mockedTodoistService.revokeAccessToken).toHaveBeenCalled();

      const conn = await integrationStore.getConnection(projectId, "todoist");
      expect(conn).toBeNull();
    });

    it("includes pending_delete warning count", async () => {
      await seedConnection(projectId);

      const db = await taskStore.getDb();
      const now = new Date().toISOString();
      for (const extId of ["t1", "t2", "t3"]) {
        await db.execute(
          `INSERT INTO integration_import_ledger
            (project_id, provider, external_item_id, feedback_id, import_status, retry_count, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [projectId, "todoist", extId, `fb-${extId}`, "pending_delete", 0, now, now]
        );
      }

      const res = await request(app).delete(todoistUrl(projectId, "")).expect(200);

      expect(res.body.data).toEqual({
        disconnected: true,
        pendingDeletesWarning: 3,
      });
    });

    it("returns 404 when not connected", async () => {
      const res = await request(app).delete(todoistUrl(projectId, "")).expect(404);

      expect(res.body.error.code).toBe("NOT_CONNECTED");
    });
  });
});
