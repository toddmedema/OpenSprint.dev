import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  createTodoistIntegrationRouter,
  oauthStateStore,
  type TodoistIntegrationRouterDeps,
} from "../routes/integrations-todoist.js";
import { errorHandler } from "../middleware/error-handler.js";

vi.mock("../services/todoist-api-client.service.js", () => ({
  generateOAuthState: vi.fn().mockReturnValue("mock-state-abc"),
  buildAuthorizationUrl: vi.fn().mockReturnValue("https://todoist.example/authorize?state=mock-state-abc"),
  exchangeCodeForToken: vi.fn().mockResolvedValue({
    accessToken: "tok-real-123",
    tokenType: "Bearer",
  }),
  getTodoistOAuthConfig: vi.fn().mockReturnValue({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:3000/api/v1/projects/proj-1/integrations/todoist/oauth/callback",
  }),
  TodoistApiClient: vi.fn().mockImplementation(() => ({
    getProjects: vi.fn().mockResolvedValue([{ id: "p1", name: "Inbox" }]),
  })),
}));

const mockedService = await import("../services/todoist-api-client.service.js");

function createTestApp(deps: TodoistIntegrationRouterDeps) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/projects/:projectId/integrations/todoist",
    createTodoistIntegrationRouter(deps),
  );
  app.use(errorHandler);
  return app;
}

function makeDeps(overrides?: Partial<TodoistIntegrationRouterDeps>): TodoistIntegrationRouterDeps {
  return {
    integrationStore: {
      upsertConnection: vi.fn().mockResolvedValue({
        id: "conn-1",
        project_id: "proj-1",
        provider: "todoist",
        status: "active",
        provider_user_id: null,
        provider_user_email: null,
        provider_resource_id: null,
        provider_resource_name: null,
        scopes: "data:read_write,data:delete",
        last_sync_at: null,
        last_error: null,
        config: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      ...(overrides?.integrationStore ?? {}),
    },
    tokenEncryption: {
      encryptToken: vi.fn().mockReturnValue("encrypted-token-abc"),
      ...(overrides?.tokenEncryption ?? {}),
    },
  };
}

describe("Todoist OAuth Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        "https://todoist.example/authorize?state=mock-state-abc",
      );
      expect(mockedService.generateOAuthState).toHaveBeenCalled();
      expect(mockedService.buildAuthorizationUrl).toHaveBeenCalledWith(
        "test-client-id",
        ["data:read_write", "data:delete"],
        "mock-state-abc",
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
        "auth-code-123",
      );

      expect(deps.tokenEncryption.encryptToken).toHaveBeenCalledWith("tok-real-123");

      expect(deps.integrationStore.upsertConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: "proj-1",
          provider: "todoist",
          access_token_enc: "encrypted-token-abc",
          status: "active",
          scopes: "data:read_write,data:delete",
        }),
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
      const stateMap = (oauthStateStore as unknown as { states: Map<string, { expiresAt: number }> }).states;
      const entry = stateMap.get("expired-state");
      if (entry) entry.expiresAt = Date.now() - 1000;

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
      const stateMap = (oauthStateStore as unknown as { states: Map<string, { expiresAt: number }> }).states;
      const entry = stateMap.get("s-expired");
      if (entry) entry.expiresAt = Date.now() - 1;

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
  });
});
