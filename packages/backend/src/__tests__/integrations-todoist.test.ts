import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createTodoistIntegrationRouter,
  OAuthStateStore,
  oauthStateStore,
  type TodoistIntegrationRouterDeps,
} from "../routes/integrations-todoist.js";
import { errorHandler } from "../middleware/error-handler.js";

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
    generateOAuthState: vi.fn().mockReturnValue("mock-state-abc"),
    buildAuthorizationUrl: vi
      .fn()
      .mockReturnValue("https://todoist.example/authorize?state=mock-state-abc"),
    exchangeCodeForToken: vi.fn().mockResolvedValue({
      accessToken: "tok-real-123",
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
      getProjects: vi.fn().mockResolvedValue([{ id: "p1", name: "Inbox" }]),
    })),
    TodoistAuthError: _TodoistAuthError,
    TodoistRateLimitError: _TodoistRateLimitError,
  };
});

const mockedService = await import("../services/todoist-api-client.service.js");

function seedTodoistServiceMocks(): void {
  vi.mocked(mockedService.generateOAuthState).mockReturnValue("mock-state-abc");
  vi.mocked(mockedService.buildAuthorizationUrl).mockReturnValue(
    "https://todoist.example/authorize?state=mock-state-abc"
  );
  vi.mocked(mockedService.exchangeCodeForToken).mockResolvedValue({
    accessToken: "tok-real-123",
    tokenType: "Bearer",
  });
  vi.mocked(mockedService.revokeAccessToken).mockResolvedValue(true);
  vi.mocked(mockedService.getTodoistOAuthConfig).mockReturnValue({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:3000/api/v1/projects/proj-1/integrations/todoist/oauth/callback",
  });
  vi.mocked(mockedService.TodoistApiClient).mockImplementation(() => ({
    getProjects: vi.fn().mockResolvedValue([{ id: "p1", name: "Inbox" }]),
  }));
}

function createTestApp(deps: TodoistIntegrationRouterDeps) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/projects/:projectId/integrations/todoist", createTodoistIntegrationRouter(deps));
  app.use(errorHandler);
  return app;
}

const DEFAULT_CONNECTION = {
  id: "conn-1",
  project_id: "proj-1",
  provider: "todoist" as const,
  status: "active" as const,
  provider_user_id: "todoist-user",
  provider_user_email: "user@example.com",
  provider_resource_id: "proj-ext-1",
  provider_resource_name: "My Todoist Project",
  scopes: "data:read_write,data:delete",
  last_sync_at: "2025-01-01T00:00:00.000Z",
  last_error: null,
  config: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function makeDeps(overrides?: Partial<TodoistIntegrationRouterDeps>): TodoistIntegrationRouterDeps {
  return {
    integrationStore: {
      upsertConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
      getConnection: vi.fn().mockResolvedValue(null),
      getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token-abc"),
      updateConnectionStatus: vi.fn().mockResolvedValue(undefined),
      updateSelectedResource: vi.fn().mockResolvedValue(undefined),
      deleteConnection: vi.fn().mockResolvedValue(undefined),
      getPendingDeletes: vi.fn().mockResolvedValue([]),
      ...(overrides?.integrationStore ?? {}),
    },
    tokenEncryption: {
      encryptToken: vi.fn().mockReturnValue("encrypted-token-abc"),
      decryptToken: vi.fn().mockReturnValue("decrypted-access-token"),
      ...(overrides?.tokenEncryption ?? {}),
    },
    todoistSyncService: {
      runSync: vi.fn().mockResolvedValue({ imported: 3, errors: 0 }),
      ...(overrides?.todoistSyncService ?? {}),
    },
  };
}

describe("Todoist OAuth Routes", () => {
  beforeEach(() => {
    // Reset all mock behavior so one-off implementations cannot leak between tests.
    vi.resetAllMocks();
    seedTodoistServiceMocks();
    oauthStateStore.destroy();
  });

  afterEach(() => {
    oauthStateStore.destroy();
  });

  describe("POST /oauth/start", () => {
    it("returns authorization URL and stores state server-side", async () => {
      const deps = makeDeps();
      const app = createTestApp(deps);

      const res = await request(app)
        .post("/api/v1/projects/proj-1/integrations/todoist/oauth/start")
        .expect(200);

      expect(res.body.data.authorizationUrl).toBe(
        "https://todoist.example/authorize?state=mock-state-abc"
      );
      expect(mockedService.generateOAuthState).toHaveBeenCalled();
      expect(mockedService.buildAuthorizationUrl).toHaveBeenCalledWith(
        "test-client-id",
        ["data:read_write", "data:delete"],
        "mock-state-abc"
      );
      expect(oauthStateStore.size).toBe(1);
    });

    it("returns 500 when OAuth config env vars are missing", async () => {
      vi.mocked(mockedService.getTodoistOAuthConfig).mockImplementationOnce(() => {
        throw new Error("Missing Todoist OAuth config");
      });

      const deps = makeDeps();
      const app = createTestApp(deps);

      const res = await request(app)
        .post("/api/v1/projects/proj-1/integrations/todoist/oauth/start")
        .expect(500);

      expect(res.body.error.code).toBe("INTEGRATION_NOT_CONFIGURED");
    });

    it("does not return state as a separate response field", async () => {
      const deps = makeDeps();
      const app = createTestApp(deps);

      const res = await request(app)
        .post("/api/v1/projects/proj-1/integrations/todoist/oauth/start")
        .expect(200);

      expect(res.body.data.state).toBeUndefined();
      expect(Object.keys(res.body.data)).toEqual(["authorizationUrl"]);
    });
  });

  describe("GET /oauth/callback", () => {
    it("exchanges code for token and stores connection", async () => {
      const deps = makeDeps();
      const app = createTestApp(deps);

      oauthStateStore.store("valid-state", "proj-1");

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/oauth/callback")
        .query({ code: "auth-code-123", state: "valid-state" })
        .set("Accept", "application/json")
        .expect(200);

      expect(res.body.data.success).toBe(true);
      expect(res.body.data.projectId).toBe("proj-1");

      expect(mockedService.exchangeCodeForToken).toHaveBeenCalledWith(
        "test-client-id",
        "test-client-secret",
        "auth-code-123"
      );

      expect(deps.tokenEncryption.encryptToken).toHaveBeenCalledWith("tok-real-123");

      expect(deps.integrationStore.upsertConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: "proj-1",
          provider: "todoist",
          access_token_enc: "encrypted-token-abc",
          status: "active",
          scopes: "data:read_write,data:delete",
        })
      );

      expect(oauthStateStore.size).toBe(0);
    });

    it("returns 400 for invalid state", async () => {
      const deps = makeDeps();
      const app = createTestApp(deps);

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/oauth/callback")
        .query({ code: "auth-code-123", state: "bogus-state" })
        .set("Accept", "application/json")
        .expect(400);

      expect(res.body.error.code).toBe("INVALID_OAUTH_STATE");
      expect(deps.integrationStore.upsertConnection).not.toHaveBeenCalled();
    });

    it("returns 400 for expired state", async () => {
      const deps = makeDeps();
      const app = createTestApp(deps);

      oauthStateStore.store("expired-state", "proj-1");
      oauthStateStore.forceExpireForTest("expired-state");

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/oauth/callback")
        .query({ code: "auth-code-123", state: "expired-state" })
        .set("Accept", "application/json")
        .expect(400);

      expect(res.body.error.code).toBe("INVALID_OAUTH_STATE");
    });

    it("returns 400 when code query param is missing", async () => {
      const deps = makeDeps();
      const app = createTestApp(deps);

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/oauth/callback")
        .query({ state: "some-state" })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it("returns 400 when state query param is missing", async () => {
      const deps = makeDeps();
      const app = createTestApp(deps);

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/oauth/callback")
        .query({ code: "some-code" })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it("redirects browser clients to settings page on success", async () => {
      const deps = makeDeps();
      const app = createTestApp(deps);

      oauthStateStore.store("browser-state", "proj-1");

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/oauth/callback")
        .query({ code: "auth-code-123", state: "browser-state" })
        .set("Accept", "text/html")
        .expect(302);

      expect(res.headers.location).toContain("/projects/proj-1/settings");
      expect(res.headers.location).toContain("integration=todoist");
      expect(res.headers.location).toContain("status=success");
    });

    it("consumes state so it cannot be reused", async () => {
      const deps = makeDeps();
      const app = createTestApp(deps);

      oauthStateStore.store("one-time-state", "proj-1");

      await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/oauth/callback")
        .query({ code: "auth-code-123", state: "one-time-state" })
        .set("Accept", "application/json")
        .expect(200);

      const res2 = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/oauth/callback")
        .query({ code: "auth-code-123", state: "one-time-state" })
        .set("Accept", "application/json")
        .expect(400);

      expect(res2.body.error.code).toBe("INVALID_OAUTH_STATE");
    });

    it("returns 500 when OAuth config is missing during callback", async () => {
      const deps = makeDeps();
      const app = createTestApp(deps);

      oauthStateStore.store("config-missing-state", "proj-1");

      vi.mocked(mockedService.getTodoistOAuthConfig).mockImplementationOnce(() => {
        throw new Error("Missing Todoist OAuth config");
      });

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/oauth/callback")
        .query({ code: "auth-code-123", state: "config-missing-state" })
        .set("Accept", "application/json")
        .expect(500);

      expect(res.body.error.code).toBe("INTEGRATION_NOT_CONFIGURED");
    });
  });

  describe("GET /status", () => {
    it("returns connected: false when no connection exists", async () => {
      const deps = makeDeps();
      const app = createTestApp(deps);

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/status")
        .expect(200);

      expect(res.body.data).toEqual({
        connected: false,
        status: "disabled",
      });
    });

    it("returns full status when connection exists with all fields", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/status")
        .expect(200);

      expect(res.body.data.connected).toBe(true);
      expect(res.body.data.status).toBe("active");
      expect(res.body.data.todoistUser).toEqual({
        id: "todoist-user",
        email: "user@example.com",
      });
      expect(res.body.data.selectedProject).toEqual({
        id: "proj-ext-1",
        name: "My Todoist Project",
      });
      expect(res.body.data.lastSyncAt).toBe("2025-01-01T00:00:00.000Z");
      expect(res.body.data.lastError).toBeUndefined();
    });

    it("omits optional fields when they are null", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({
            ...DEFAULT_CONNECTION,
            provider_user_id: null,
            provider_user_email: null,
            provider_resource_id: null,
            provider_resource_name: null,
            last_sync_at: null,
            last_error: null,
          }),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/status")
        .expect(200);

      expect(res.body.data.connected).toBe(true);
      expect(res.body.data.todoistUser).toBeUndefined();
      expect(res.body.data.selectedProject).toBeUndefined();
      expect(res.body.data.lastSyncAt).toBeUndefined();
      expect(res.body.data.lastError).toBeUndefined();
    });

    it("includes lastError when present", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({
            ...DEFAULT_CONNECTION,
            last_error: "Something went wrong",
            status: "needs_reconnect",
          }),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/status")
        .expect(200);

      expect(res.body.data.lastError).toBe("Something went wrong");
      expect(res.body.data.status).toBe("needs_reconnect");
    });

    it("never returns tokens in the status response", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/status")
        .expect(200);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain("access_token");
      expect(body).not.toContain("refresh_token");
      expect(body).not.toContain("encrypted");
    });
  });

  describe("GET /projects", () => {
    it("returns 404 when not connected", async () => {
      const deps = makeDeps();
      const app = createTestApp(deps);

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/projects")
        .expect(404);

      expect(res.body.error.code).toBe("NOT_CONNECTED");
    });

    it("returns 409 when connection needs reconnect", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({
            ...DEFAULT_CONNECTION,
            status: "needs_reconnect",
          }),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/projects")
        .expect(409);

      expect(res.body.error.code).toBe("NEEDS_RECONNECT");
    });

    it("returns projects list on success", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token-abc"),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/projects")
        .expect(200);

      expect(res.body.data.projects).toEqual([{ id: "p1", name: "Inbox" }]);
      expect(deps.tokenEncryption.decryptToken).toHaveBeenCalledWith("encrypted-token-abc");
    });

    it("returns 401 and marks needs_reconnect on TodoistAuthError", async () => {
      const { TodoistAuthError } = mockedService;
      vi.mocked(mockedService.TodoistApiClient).mockImplementationOnce(
        () =>
          ({
            getProjects: vi.fn().mockRejectedValue(new TodoistAuthError("bad token", 401)),
          }) as ReturnType<typeof mockedService.TodoistApiClient>
      );

      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token-abc"),
          updateConnectionStatus: vi.fn().mockResolvedValue(undefined),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/projects")
        .expect(401);

      expect(res.body.error.code).toBe("TODOIST_AUTH_FAILED");
      expect(deps.integrationStore.updateConnectionStatus).toHaveBeenCalledWith(
        "conn-1",
        "needs_reconnect",
        "bad token"
      );
    });

    it("returns 429 with Retry-After on TodoistRateLimitError", async () => {
      const { TodoistRateLimitError } = mockedService;
      vi.mocked(mockedService.TodoistApiClient).mockImplementationOnce(
        () =>
          ({
            getProjects: vi.fn().mockRejectedValue(new TodoistRateLimitError("rate limited", 30)),
          }) as ReturnType<typeof mockedService.TodoistApiClient>
      );

      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token-abc"),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/projects")
        .expect(429);

      expect(res.body.error.code).toBe("RATE_LIMITED");
      expect(res.body.error.retryAfter).toBe(30);
      expect(res.headers["retry-after"]).toBe("30");
    });

    it("returns 500 when encrypted token is missing", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue(null),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/projects")
        .expect(500);

      expect(res.body.error.code).toBe("TOKEN_MISSING");
    });

    it("returns 500 when token decryption fails", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token-abc"),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
        tokenEncryption: {
          decryptToken: vi.fn().mockImplementation(() => {
            throw new Error("decryption failed");
          }),
        } as Partial<
          TodoistIntegrationRouterDeps["tokenEncryption"]
        > as TodoistIntegrationRouterDeps["tokenEncryption"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .get("/api/v1/projects/proj-1/integrations/todoist/projects")
        .expect(500);

      expect(res.body.error.code).toBe("TOKEN_DECRYPT_FAILED");
    });
  });

  describe("PUT /project", () => {
    it("returns 404 when not connected", async () => {
      const deps = makeDeps();
      const app = createTestApp(deps);

      const res = await request(app)
        .put("/api/v1/projects/proj-1/integrations/todoist/project")
        .send({ todoistProjectId: "p1" })
        .expect(404);

      expect(res.body.error.code).toBe("NOT_CONNECTED");
    });

    it("returns 400 when body is missing todoistProjectId", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .put("/api/v1/projects/proj-1/integrations/todoist/project")
        .send({})
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it("returns 400 when todoistProjectId is empty string", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .put("/api/v1/projects/proj-1/integrations/todoist/project")
        .send({ todoistProjectId: "" })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it("returns 400 when selected project does not exist in Todoist", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token-abc"),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .put("/api/v1/projects/proj-1/integrations/todoist/project")
        .send({ todoistProjectId: "nonexistent-project" })
        .expect(400);

      expect(res.body.error.code).toBe("PROJECT_NOT_FOUND");
      expect(res.body.error.message).toBe("Todoist project not found");
    });

    it("selects project and persists selection on success", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token-abc"),
          updateSelectedResource: vi.fn().mockResolvedValue(undefined),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .put("/api/v1/projects/proj-1/integrations/todoist/project")
        .send({ todoistProjectId: "p1" })
        .expect(200);

      expect(res.body.data).toEqual({
        success: true,
        selectedProject: { id: "p1", name: "Inbox" },
      });
      expect(deps.integrationStore.updateSelectedResource).toHaveBeenCalledWith(
        "conn-1",
        "p1",
        "Inbox"
      );
    });

    it("returns 500 when encrypted token is missing", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue(null),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .put("/api/v1/projects/proj-1/integrations/todoist/project")
        .send({ todoistProjectId: "p1" })
        .expect(500);

      expect(res.body.error.code).toBe("TOKEN_MISSING");
    });

    it("returns 500 when token decryption fails", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token-abc"),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
        tokenEncryption: {
          decryptToken: vi.fn().mockImplementation(() => {
            throw new Error("decryption failed");
          }),
        } as Partial<
          TodoistIntegrationRouterDeps["tokenEncryption"]
        > as TodoistIntegrationRouterDeps["tokenEncryption"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .put("/api/v1/projects/proj-1/integrations/todoist/project")
        .send({ todoistProjectId: "p1" })
        .expect(500);

      expect(res.body.error.code).toBe("TOKEN_DECRYPT_FAILED");
    });

    it("returns 401 and marks needs_reconnect on TodoistAuthError", async () => {
      const { TodoistAuthError } = mockedService;
      vi.mocked(mockedService.TodoistApiClient).mockImplementationOnce(
        () =>
          ({
            getProjects: vi.fn().mockRejectedValue(new TodoistAuthError("bad token", 401)),
          }) as ReturnType<typeof mockedService.TodoistApiClient>
      );

      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token-abc"),
          updateConnectionStatus: vi.fn().mockResolvedValue(undefined),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .put("/api/v1/projects/proj-1/integrations/todoist/project")
        .send({ todoistProjectId: "p1" })
        .expect(401);

      expect(res.body.error.code).toBe("TODOIST_AUTH_FAILED");
      expect(deps.integrationStore.updateConnectionStatus).toHaveBeenCalledWith(
        "conn-1",
        "needs_reconnect",
        "bad token"
      );
    });

    it("returns 429 with Retry-After on TodoistRateLimitError", async () => {
      const { TodoistRateLimitError } = mockedService;
      vi.mocked(mockedService.TodoistApiClient).mockImplementationOnce(
        () =>
          ({
            getProjects: vi.fn().mockRejectedValue(new TodoistRateLimitError("rate limited", 45)),
          }) as ReturnType<typeof mockedService.TodoistApiClient>
      );

      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token-abc"),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .put("/api/v1/projects/proj-1/integrations/todoist/project")
        .send({ todoistProjectId: "p1" })
        .expect(429);

      expect(res.body.error.code).toBe("RATE_LIMITED");
      expect(res.body.error.retryAfter).toBe(45);
      expect(res.headers["retry-after"]).toBe("45");
    });
  });

  describe("POST /sync", () => {
    it("returns 404 when not connected", async () => {
      const deps = makeDeps();
      const app = createTestApp(deps);

      const res = await request(app)
        .post("/api/v1/projects/proj-1/integrations/todoist/sync")
        .expect(404);

      expect(res.body.error.code).toBe("NOT_CONNECTED");
    });

    it("returns 409 when connection needs reconnect", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({
            ...DEFAULT_CONNECTION,
            status: "needs_reconnect",
          }),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .post("/api/v1/projects/proj-1/integrations/todoist/sync")
        .expect(409);

      expect(res.body.error.code).toBe("NEEDS_RECONNECT");
    });

    it("returns 429 when last sync was less than 10 seconds ago", async () => {
      const recentSync = new Date(Date.now() - 3000).toISOString();
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({
            ...DEFAULT_CONNECTION,
            last_sync_at: recentSync,
          }),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .post("/api/v1/projects/proj-1/integrations/todoist/sync")
        .expect(429);

      expect(res.body.error.code).toBe("SYNC_RATE_LIMITED");
    });

    it("allows sync when last_sync_at is older than 10 seconds", async () => {
      const oldSync = new Date(Date.now() - 15000).toISOString();
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({
            ...DEFAULT_CONNECTION,
            last_sync_at: oldSync,
          }),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .post("/api/v1/projects/proj-1/integrations/todoist/sync")
        .expect(200);

      expect(res.body.data).toEqual({ imported: 3, errors: 0 });
      expect(deps.todoistSyncService!.runSync).toHaveBeenCalledWith("conn-1");
    });

    it("allows sync when last_sync_at is null", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({
            ...DEFAULT_CONNECTION,
            last_sync_at: null,
          }),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .post("/api/v1/projects/proj-1/integrations/todoist/sync")
        .expect(200);

      expect(res.body.data).toEqual({ imported: 3, errors: 0 });
    });

    it("returns sync result on success", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({
            ...DEFAULT_CONNECTION,
            last_sync_at: null,
          }),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
        todoistSyncService: {
          runSync: vi.fn().mockResolvedValue({ imported: 5, errors: 2 }),
        },
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .post("/api/v1/projects/proj-1/integrations/todoist/sync")
        .expect(200);

      expect(res.body.data).toEqual({ imported: 5, errors: 2 });
    });

    it("returns 500 when sync service is not configured", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({
            ...DEFAULT_CONNECTION,
            last_sync_at: null,
          }),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      deps.todoistSyncService = undefined;
      const app = createTestApp(deps);

      const res = await request(app)
        .post("/api/v1/projects/proj-1/integrations/todoist/sync")
        .expect(500);

      expect(res.body.error.code).toBe("SYNC_NOT_AVAILABLE");
    });
  });

  describe("DELETE /", () => {
    it("returns 404 when not connected", async () => {
      const deps = makeDeps();
      const app = createTestApp(deps);

      const res = await request(app)
        .delete("/api/v1/projects/proj-1/integrations/todoist")
        .expect(404);

      expect(res.body.error.code).toBe("NOT_CONNECTED");
    });

    it("disconnects and returns success", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token-abc"),
          deleteConnection: vi.fn().mockResolvedValue(undefined),
          getPendingDeletes: vi.fn().mockResolvedValue([]),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .delete("/api/v1/projects/proj-1/integrations/todoist")
        .expect(200);

      expect(res.body.data).toEqual({ disconnected: true });
      expect(deps.integrationStore.deleteConnection).toHaveBeenCalledWith("proj-1", "todoist");
    });

    it("revokes token before deleting connection", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token-abc"),
          deleteConnection: vi.fn().mockResolvedValue(undefined),
          getPendingDeletes: vi.fn().mockResolvedValue([]),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      await request(app).delete("/api/v1/projects/proj-1/integrations/todoist").expect(200);

      expect(mockedService.revokeAccessToken).toHaveBeenCalledWith(
        "test-client-id",
        "test-client-secret",
        "decrypted-access-token"
      );
    });

    it("proceeds with disconnect even when token revocation fails", async () => {
      vi.mocked(mockedService.revokeAccessToken).mockRejectedValueOnce(
        new Error("revocation failed")
      );

      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token-abc"),
          deleteConnection: vi.fn().mockResolvedValue(undefined),
          getPendingDeletes: vi.fn().mockResolvedValue([]),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .delete("/api/v1/projects/proj-1/integrations/todoist")
        .expect(200);

      expect(res.body.data).toEqual({ disconnected: true });
      expect(deps.integrationStore.deleteConnection).toHaveBeenCalled();
    });

    it("proceeds with disconnect even when token decryption fails", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token-abc"),
          deleteConnection: vi.fn().mockResolvedValue(undefined),
          getPendingDeletes: vi.fn().mockResolvedValue([]),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
        tokenEncryption: {
          decryptToken: vi.fn().mockImplementation(() => {
            throw new Error("decryption failed");
          }),
        } as Partial<
          TodoistIntegrationRouterDeps["tokenEncryption"]
        > as TodoistIntegrationRouterDeps["tokenEncryption"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .delete("/api/v1/projects/proj-1/integrations/todoist")
        .expect(200);

      expect(res.body.data).toEqual({ disconnected: true });
      expect(deps.integrationStore.deleteConnection).toHaveBeenCalled();
    });

    it("includes pending deletes warning when there are pending deletes", async () => {
      const pendingEntries = [
        {
          id: "1",
          project_id: "proj-1",
          provider: "todoist",
          external_item_id: "t1",
          feedback_id: "f1",
          import_status: "pending_delete",
          last_error: null,
          retry_count: 0,
          created_at: "",
          updated_at: "",
        },
        {
          id: "2",
          project_id: "proj-1",
          provider: "todoist",
          external_item_id: "t2",
          feedback_id: "f2",
          import_status: "pending_delete",
          last_error: null,
          retry_count: 0,
          created_at: "",
          updated_at: "",
        },
        {
          id: "3",
          project_id: "proj-1",
          provider: "todoist",
          external_item_id: "t3",
          feedback_id: "f3",
          import_status: "failed_delete",
          last_error: "err",
          retry_count: 1,
          created_at: "",
          updated_at: "",
        },
      ];

      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token-abc"),
          deleteConnection: vi.fn().mockResolvedValue(undefined),
          getPendingDeletes: vi.fn().mockResolvedValue(pendingEntries),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .delete("/api/v1/projects/proj-1/integrations/todoist")
        .expect(200);

      expect(res.body.data).toEqual({
        disconnected: true,
        pendingDeletesWarning: 3,
      });
    });

    it("skips token revocation when no encrypted token is stored", async () => {
      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue(null),
          deleteConnection: vi.fn().mockResolvedValue(undefined),
          getPendingDeletes: vi.fn().mockResolvedValue([]),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .delete("/api/v1/projects/proj-1/integrations/todoist")
        .expect(200);

      expect(res.body.data).toEqual({ disconnected: true });
      expect(mockedService.revokeAccessToken).not.toHaveBeenCalled();
      expect(deps.integrationStore.deleteConnection).toHaveBeenCalled();
    });

    it("proceeds with disconnect even when OAuth config is missing", async () => {
      vi.mocked(mockedService.getTodoistOAuthConfig).mockImplementationOnce(() => {
        throw new Error("Missing Todoist OAuth config");
      });

      const deps = makeDeps({
        integrationStore: {
          getConnection: vi.fn().mockResolvedValue({ ...DEFAULT_CONNECTION }),
          getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token-abc"),
          deleteConnection: vi.fn().mockResolvedValue(undefined),
          getPendingDeletes: vi.fn().mockResolvedValue([]),
        } as Partial<
          TodoistIntegrationRouterDeps["integrationStore"]
        > as TodoistIntegrationRouterDeps["integrationStore"],
      });
      const app = createTestApp(deps);

      const res = await request(app)
        .delete("/api/v1/projects/proj-1/integrations/todoist")
        .expect(200);

      expect(res.body.data).toEqual({ disconnected: true });
      expect(deps.integrationStore.deleteConnection).toHaveBeenCalled();
    });
  });

  describe("OAuthStateStore", () => {
    it("stores and consumes state correctly", () => {
      oauthStateStore.store("s1", "proj-a");
      expect(oauthStateStore.size).toBe(1);

      const projectId = oauthStateStore.consume("s1");
      expect(projectId).toBe("proj-a");
      expect(oauthStateStore.size).toBe(0);
    });

    it("returns null for unknown state", () => {
      expect(oauthStateStore.consume("nonexistent")).toBeNull();
    });

    it("returns null for expired state and removes it", () => {
      oauthStateStore.store("s-expired", "proj-b");
      oauthStateStore.forceExpireForTest("s-expired");

      expect(oauthStateStore.consume("s-expired")).toBeNull();
      expect(oauthStateStore.size).toBe(0);
    });

    it("destroy clears all state", () => {
      oauthStateStore.store("d1", "p1");
      oauthStateStore.store("d2", "p2");
      expect(oauthStateStore.size).toBe(2);

      oauthStateStore.destroy();
      expect(oauthStateStore.size).toBe(0);
    });

    it("persists states across store instances", () => {
      const storagePath = path.join(os.tmpdir(), `oauth-state-${Date.now()}.json`);
      const first = new OAuthStateStore(storagePath);
      first.store("restart-state", "proj-restart");
      const second = new OAuthStateStore(storagePath);

      expect(second.consume("restart-state")).toBe("proj-restart");

      first.destroy();
      second.destroy();
    });

    it("creates parent directory with 0o700 and state file with 0o600 on POSIX", () => {
      if (process.platform === "win32") {
        return;
      }
      const base = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-perms-"));
      const nestedDir = path.join(base, ".opensprint");
      const filePath = path.join(nestedDir, "todoist-oauth-states.json");
      const store = new OAuthStateStore(filePath);
      store.store("perm-state", "proj-perm");

      const dirStat = fs.statSync(nestedDir);
      const fileStat = fs.statSync(filePath);
      expect(dirStat.mode & 0o777).toBe(0o700);
      expect(fileStat.mode & 0o777).toBe(0o600);

      store.destroy();
      fs.rmSync(base, { recursive: true, force: true });
    });

    it("tightens permissions when persisting over an existing loose file on POSIX", () => {
      if (process.platform === "win32") {
        return;
      }
      const base = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-perms-loose-"));
      const filePath = path.join(base, "todoist-oauth-states.json");
      fs.mkdirSync(base, { recursive: true });
      fs.writeFileSync(filePath, "{}", "utf8");
      fs.chmodSync(filePath, 0o644);
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o644);

      const store = new OAuthStateStore(filePath);
      store.store("after-loose", "proj-x");
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);

      store.destroy();
      fs.rmSync(base, { recursive: true, force: true });
    });
  });
});
