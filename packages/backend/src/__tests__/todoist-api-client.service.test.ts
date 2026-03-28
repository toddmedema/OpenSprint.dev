import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TodoistRequestError } from "@doist/todoist-api-typescript";

vi.mock("@doist/todoist-api-typescript", async () => {
  const actual = await vi.importActual<
    typeof import("@doist/todoist-api-typescript")
  >("@doist/todoist-api-typescript");
  return {
    ...actual,
    TodoistApi: vi.fn(),
    getAuthStateParameter: vi.fn().mockReturnValue("mock-state-uuid"),
    getAuthorizationUrl: vi.fn().mockReturnValue("https://todoist.example/oauth"),
    getAuthToken: vi.fn().mockResolvedValue({
      accessToken: "tok-123",
      tokenType: "Bearer",
    }),
    revokeToken: vi.fn().mockResolvedValue(true),
  };
});

const {
  TodoistApi: MockTodoistApi,
  getAuthStateParameter: mockGetAuthState,
  getAuthorizationUrl: mockGetAuthUrl,
  getAuthToken: mockGetAuthToken,
  revokeToken: mockRevokeToken,
} = await import("@doist/todoist-api-typescript");

const {
  TodoistApiClient,
  TodoistAuthError,
  TodoistRateLimitError,
  generateOAuthState,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  revokeAccessToken,
  getTodoistOAuthConfig,
} = await import("../services/todoist-api-client.service.js");

function makeProject(id: string, name: string) {
  return { id, name, color: "blue", childOrder: 0 };
}

function makeTask(id: string, content: string) {
  return {
    id,
    content,
    description: "",
    projectId: "p1",
    labels: [],
    priority: 1,
    addedAt: "2025-01-01T00:00:00Z",
  };
}

describe("TodoistApiClient", () => {
  let mockApi: {
    getProjects: ReturnType<typeof vi.fn>;
    getTasks: ReturnType<typeof vi.fn>;
    deleteTask: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockApi = {
      getProjects: vi.fn(),
      getTasks: vi.fn(),
      deleteTask: vi.fn(),
    };
    vi.mocked(MockTodoistApi).mockImplementation(() => mockApi as never);
  });

  describe("getProjects", () => {
    it("returns mapped project info from a single page", async () => {
      mockApi.getProjects.mockResolvedValue({
        results: [makeProject("1", "Inbox"), makeProject("2", "Work")],
        nextCursor: null,
      });

      const client = new TodoistApiClient("tok");
      const projects = await client.getProjects();

      expect(projects).toEqual([
        { id: "1", name: "Inbox" },
        { id: "2", name: "Work" },
      ]);
      expect(mockApi.getProjects).toHaveBeenCalledTimes(1);
    });

    it("paginates through multiple pages", async () => {
      mockApi.getProjects
        .mockResolvedValueOnce({
          results: [makeProject("1", "A")],
          nextCursor: "cursor-2",
        })
        .mockResolvedValueOnce({
          results: [makeProject("2", "B")],
          nextCursor: null,
        });

      const client = new TodoistApiClient("tok");
      const projects = await client.getProjects();

      expect(projects).toHaveLength(2);
      expect(mockApi.getProjects).toHaveBeenCalledTimes(2);
      expect(mockApi.getProjects).toHaveBeenLastCalledWith({ cursor: "cursor-2" });
    });

    it("throws TodoistAuthError on 401", async () => {
      mockApi.getProjects.mockRejectedValue(
        new TodoistRequestError("Unauthorized", 401),
      );

      const client = new TodoistApiClient("tok");
      await expect(client.getProjects()).rejects.toThrow(TodoistAuthError);
    });

    it("throws TodoistAuthError on 403", async () => {
      mockApi.getProjects.mockRejectedValue(
        new TodoistRequestError("Forbidden", 403),
      );

      const client = new TodoistApiClient("tok");
      const err = await client.getProjects().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TodoistAuthError);
      expect((err as InstanceType<typeof TodoistAuthError>).httpStatusCode).toBe(403);
    });

    it("throws TodoistRateLimitError on 429 with retryAfter", async () => {
      mockApi.getProjects.mockRejectedValue(
        new TodoistRequestError("Too Many Requests", 429, { retry_after: 30 }),
      );

      const client = new TodoistApiClient("tok");
      const err = await client.getProjects().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TodoistRateLimitError);
      expect((err as InstanceType<typeof TodoistRateLimitError>).retryAfter).toBe(30);
    });

    it("defaults retryAfter to 60 when not in response", async () => {
      mockApi.getProjects.mockRejectedValue(
        new TodoistRequestError("Too Many Requests", 429),
      );

      const client = new TodoistApiClient("tok");
      const err = await client.getProjects().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TodoistRateLimitError);
      expect((err as InstanceType<typeof TodoistRateLimitError>).retryAfter).toBe(60);
    });

    it("wraps unknown SDK errors with context", async () => {
      mockApi.getProjects.mockRejectedValue(
        new TodoistRequestError("Server Error", 500),
      );

      const client = new TodoistApiClient("tok");
      await expect(client.getProjects()).rejects.toThrow(
        /Todoist API error during getProjects/,
      );
    });

    it("wraps non-TodoistRequestError errors", async () => {
      mockApi.getProjects.mockRejectedValue(new Error("ECONNRESET"));

      const client = new TodoistApiClient("tok");
      await expect(client.getProjects()).rejects.toThrow(
        /Todoist request failed during getProjects.*ECONNRESET/,
      );
    });
  });

  describe("getTasks", () => {
    it("returns all tasks from a single page", async () => {
      mockApi.getTasks.mockResolvedValue({
        results: [makeTask("t1", "Buy milk"), makeTask("t2", "Write tests")],
        nextCursor: null,
      });

      const client = new TodoistApiClient("tok");
      const tasks = await client.getTasks("p1");

      expect(tasks).toHaveLength(2);
      expect(tasks[0].content).toBe("Buy milk");
      expect(mockApi.getTasks).toHaveBeenCalledWith({ projectId: "p1" });
    });

    it("paginates through multiple pages of tasks", async () => {
      mockApi.getTasks
        .mockResolvedValueOnce({
          results: Array.from({ length: 200 }, (_, i) =>
            makeTask(`t${i}`, `Task ${i}`),
          ),
          nextCursor: "page2",
        })
        .mockResolvedValueOnce({
          results: [makeTask("t200", "Task 200")],
          nextCursor: null,
        });

      const client = new TodoistApiClient("tok");
      const tasks = await client.getTasks("p1");

      expect(tasks).toHaveLength(201);
      expect(mockApi.getTasks).toHaveBeenCalledTimes(2);
      expect(mockApi.getTasks).toHaveBeenLastCalledWith({
        projectId: "p1",
        cursor: "page2",
      });
    });

    it("throws TodoistAuthError on 401", async () => {
      mockApi.getTasks.mockRejectedValue(
        new TodoistRequestError("Unauthorized", 401),
      );

      const client = new TodoistApiClient("tok");
      await expect(client.getTasks("p1")).rejects.toThrow(TodoistAuthError);
    });

    it("throws TodoistRateLimitError on 429", async () => {
      mockApi.getTasks.mockRejectedValue(
        new TodoistRequestError("Rate limited", 429, { retry_after: 15 }),
      );

      const client = new TodoistApiClient("tok");
      await expect(client.getTasks("p1")).rejects.toThrow(TodoistRateLimitError);
    });
  });

  describe("deleteTask", () => {
    it("returns true on successful deletion", async () => {
      mockApi.deleteTask.mockResolvedValue(true);

      const client = new TodoistApiClient("tok");
      const result = await client.deleteTask("t1");

      expect(result).toBe(true);
      expect(mockApi.deleteTask).toHaveBeenCalledWith("t1");
    });

    it("treats 404 as success (already deleted)", async () => {
      mockApi.deleteTask.mockRejectedValue(
        new TodoistRequestError("Not found", 404),
      );

      const client = new TodoistApiClient("tok");
      const result = await client.deleteTask("t1");

      expect(result).toBe(true);
    });

    it("throws TodoistAuthError on 401", async () => {
      mockApi.deleteTask.mockRejectedValue(
        new TodoistRequestError("Unauthorized", 401),
      );

      const client = new TodoistApiClient("tok");
      await expect(client.deleteTask("t1")).rejects.toThrow(TodoistAuthError);
    });

    it("throws TodoistRateLimitError on 429", async () => {
      mockApi.deleteTask.mockRejectedValue(
        new TodoistRequestError("Rate limited", 429, { retry_after: 5 }),
      );

      const client = new TodoistApiClient("tok");
      const err = await client.deleteTask("t1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TodoistRateLimitError);
      expect((err as InstanceType<typeof TodoistRateLimitError>).retryAfter).toBe(5);
    });

    it("wraps other HTTP errors with context", async () => {
      mockApi.deleteTask.mockRejectedValue(
        new TodoistRequestError("Internal Server Error", 500),
      );

      const client = new TodoistApiClient("tok");
      await expect(client.deleteTask("t1")).rejects.toThrow(
        /Todoist API error during deleteTask/,
      );
    });
  });
});

describe("OAuth helpers", () => {
  it("generateOAuthState delegates to SDK getAuthStateParameter", () => {
    const state = generateOAuthState();
    expect(state).toBe("mock-state-uuid");
    expect(mockGetAuthState).toHaveBeenCalled();
  });

  it("buildAuthorizationUrl delegates to SDK getAuthorizationUrl", () => {
    const url = buildAuthorizationUrl(
      "client-id",
      ["data:read_write", "data:delete"],
      "state-123",
    );
    expect(url).toBe("https://todoist.example/oauth");
    expect(mockGetAuthUrl).toHaveBeenCalledWith({
      clientId: "client-id",
      permissions: ["data:read_write", "data:delete"],
      state: "state-123",
    });
  });

  it("exchangeCodeForToken delegates to SDK getAuthToken", async () => {
    const result = await exchangeCodeForToken("cid", "csecret", "code-xyz");
    expect(result).toEqual({ accessToken: "tok-123", tokenType: "Bearer" });
    expect(mockGetAuthToken).toHaveBeenCalledWith({
      clientId: "cid",
      clientSecret: "csecret",
      code: "code-xyz",
    });
  });

  it("exchangeCodeForToken wraps SDK errors", async () => {
    vi.mocked(mockGetAuthToken).mockRejectedValueOnce(
      new TodoistRequestError("Bad code", 400),
    );
    await expect(
      exchangeCodeForToken("cid", "csecret", "bad-code"),
    ).rejects.toThrow(/Todoist API error during exchangeCodeForToken/);
  });

  it("exchangeCodeForToken throws TodoistAuthError on 401", async () => {
    vi.mocked(mockGetAuthToken).mockRejectedValueOnce(
      new TodoistRequestError("Unauthorized", 401),
    );
    await expect(
      exchangeCodeForToken("cid", "csecret", "bad-code"),
    ).rejects.toThrow(TodoistAuthError);
  });

  it("revokeAccessToken delegates to SDK revokeToken", async () => {
    const result = await revokeAccessToken("cid", "csecret", "tok-abc");
    expect(result).toBe(true);
    expect(mockRevokeToken).toHaveBeenCalledWith({
      clientId: "cid",
      clientSecret: "csecret",
      token: "tok-abc",
    });
  });

  it("revokeAccessToken wraps SDK errors", async () => {
    vi.mocked(mockRevokeToken).mockRejectedValueOnce(
      new TodoistRequestError("Server error", 500),
    );
    await expect(
      revokeAccessToken("cid", "csecret", "tok-abc"),
    ).rejects.toThrow(/Todoist API error during revokeAccessToken/);
  });
});

describe("getTodoistOAuthConfig", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("returns config when all env vars are set", () => {
    process.env.TODOIST_CLIENT_ID = "cid";
    process.env.TODOIST_CLIENT_SECRET = "csecret";
    process.env.TODOIST_REDIRECT_URI = "http://localhost:3000/callback";

    const config = getTodoistOAuthConfig();
    expect(config).toEqual({
      clientId: "cid",
      clientSecret: "csecret",
      redirectUri: "http://localhost:3000/callback",
    });
  });

  it("throws when TODOIST_CLIENT_ID is missing", () => {
    delete process.env.TODOIST_CLIENT_ID;
    process.env.TODOIST_CLIENT_SECRET = "csecret";
    process.env.TODOIST_REDIRECT_URI = "http://localhost:3000/callback";

    expect(() => getTodoistOAuthConfig()).toThrow(/Missing Todoist OAuth config/);
  });

  it("throws when TODOIST_CLIENT_SECRET is missing", () => {
    process.env.TODOIST_CLIENT_ID = "cid";
    delete process.env.TODOIST_CLIENT_SECRET;
    process.env.TODOIST_REDIRECT_URI = "http://localhost:3000/callback";

    expect(() => getTodoistOAuthConfig()).toThrow(/Missing Todoist OAuth config/);
  });

  it("throws when TODOIST_REDIRECT_URI is missing", () => {
    process.env.TODOIST_CLIENT_ID = "cid";
    process.env.TODOIST_CLIENT_SECRET = "csecret";
    delete process.env.TODOIST_REDIRECT_URI;

    expect(() => getTodoistOAuthConfig()).toThrow(/Missing Todoist OAuth config/);
  });
});

describe("Custom error classes", () => {
  it("TodoistAuthError has correct name and properties", () => {
    const err = new TodoistAuthError("Token expired", 401);
    expect(err.name).toBe("TodoistAuthError");
    expect(err.message).toBe("Token expired");
    expect(err.httpStatusCode).toBe(401);
    expect(err).toBeInstanceOf(Error);
  });

  it("TodoistRateLimitError has correct name and properties", () => {
    const err = new TodoistRateLimitError("Slow down", 30);
    expect(err.name).toBe("TodoistRateLimitError");
    expect(err.message).toBe("Slow down");
    expect(err.retryAfter).toBe(30);
    expect(err).toBeInstanceOf(Error);
  });
});
