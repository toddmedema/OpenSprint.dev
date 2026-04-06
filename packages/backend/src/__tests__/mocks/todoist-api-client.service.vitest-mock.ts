import { vi } from "vitest";

/**
 * Single Vitest mock factory for `../services/todoist-api-client.service.js`.
 *
 * Several route suites import `createApp` or integration routers that transitively load this
 * module. Duplicate `vi.mock(...)` blocks with different shapes cause whichever file Vitest loads
 * first to win, producing intermittent failures (e.g. OAuth start returning 401 instead of 500).
 */
export function createTodoistApiClientVitestMock() {
  class TodoistAuthError extends Error {
    override name = "TodoistAuthError" as const;
    constructor(
      message: string,
      public readonly httpStatusCode: number
    ) {
      super(message);
    }
  }

  class TodoistRateLimitError extends Error {
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
    getTodoistOAuthConfig: vi.fn().mockResolvedValue({
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
    TodoistAuthError,
    TodoistRateLimitError,
  };
}
