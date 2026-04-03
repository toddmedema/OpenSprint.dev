/**
 * Wrapper around @doist/todoist-api-typescript SDK providing error handling,
 * rate-limit awareness, and OAuth helpers for the Todoist integration.
 */

import {
  TodoistApi,
  TodoistRequestError,
  getAuthStateParameter,
  getAuthorizationUrl,
  getAuthToken,
  revokeToken,
} from "@doist/todoist-api-typescript";
import type {
  Task,
  PersonalProject,
  WorkspaceProject,
  Permission,
} from "@doist/todoist-api-typescript";
import { createLogger } from "../utils/logger.js";
import { getGlobalSettings } from "./global-settings.service.js";

const log = createLogger("todoist-api-client");

// ─── Custom Error Classes ───

export class TodoistAuthError extends Error {
  override name = "TodoistAuthError" as const;
  constructor(
    message: string,
    public readonly httpStatusCode: number
  ) {
    super(message);
  }
}

export class TodoistRateLimitError extends Error {
  override name = "TodoistRateLimitError" as const;
  constructor(
    message: string,
    public readonly retryAfter: number
  ) {
    super(message);
  }
}

// ─── Return Types ───

export interface TodoistProjectInfo {
  id: string;
  name: string;
}

// ─── Error Handling ───

function classifyAndThrow(err: unknown, context: string): never {
  if (err instanceof TodoistRequestError) {
    const status = err.httpStatusCode;

    if (status === 401 || status === 403) {
      throw new TodoistAuthError(`Todoist auth failed during ${context}: ${err.message}`, status);
    }

    if (status === 429) {
      let retryAfter = 60;
      const data = err.responseData;
      if (data && typeof data === "object" && "retry_after" in data) {
        const parsed = Number((data as Record<string, unknown>).retry_after);
        if (Number.isFinite(parsed) && parsed > 0) retryAfter = parsed;
      }
      throw new TodoistRateLimitError(`Todoist rate limited during ${context}`, retryAfter);
    }

    throw new Error(
      `Todoist API error during ${context} (HTTP ${status ?? "unknown"}): ${err.message}`
    );
  }

  if (err instanceof Error) {
    throw new Error(`Todoist request failed during ${context}: ${err.message}`);
  }

  throw new Error(`Todoist request failed during ${context}: ${String(err)}`);
}

// ─── API Client ───

export class TodoistApiClient {
  private api: TodoistApi;

  constructor(accessToken: string) {
    this.api = new TodoistApi(accessToken);
  }

  async getProjects(): Promise<TodoistProjectInfo[]> {
    try {
      const projects: (PersonalProject | WorkspaceProject)[] = [];
      let cursor: string | null | undefined;

      do {
        const response = await this.api.getProjects(cursor ? { cursor } : undefined);
        projects.push(...response.results);
        cursor = response.nextCursor;
      } while (cursor);

      return projects.map((p) => ({ id: p.id, name: p.name }));
    } catch (err) {
      if (err instanceof TodoistAuthError || err instanceof TodoistRateLimitError) {
        throw err;
      }
      return classifyAndThrow(err, "getProjects");
    }
  }

  async getTasks(todoistProjectId: string): Promise<Task[]> {
    try {
      const tasks: Task[] = [];
      let cursor: string | null | undefined;

      do {
        const response = await this.api.getTasks(
          cursor ? { projectId: todoistProjectId, cursor } : { projectId: todoistProjectId }
        );
        tasks.push(...response.results);
        cursor = response.nextCursor;
      } while (cursor);

      return tasks;
    } catch (err) {
      if (err instanceof TodoistAuthError || err instanceof TodoistRateLimitError) {
        throw err;
      }
      return classifyAndThrow(err, "getTasks");
    }
  }

  async deleteTask(taskId: string): Promise<boolean> {
    try {
      return await this.api.deleteTask(taskId);
    } catch (err) {
      if (err instanceof TodoistRequestError && err.httpStatusCode === 404) {
        log.info("Todoist task already deleted (404 treated as success)", {
          taskId,
        });
        return true;
      }

      if (err instanceof TodoistAuthError || err instanceof TodoistRateLimitError) {
        throw err;
      }
      return classifyAndThrow(err, "deleteTask");
    }
  }
}

// ─── OAuth Helpers ───

export function generateOAuthState(): string {
  return getAuthStateParameter();
}

export function buildAuthorizationUrl(
  clientId: string,
  scopes: readonly Permission[],
  state: string
): string {
  return getAuthorizationUrl({ clientId, permissions: scopes, state });
}

export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string
): Promise<{ accessToken: string; tokenType: string }> {
  try {
    return await getAuthToken({ clientId, clientSecret, code });
  } catch (err) {
    return classifyAndThrow(err, "exchangeCodeForToken");
  }
}

export async function revokeAccessToken(
  clientId: string,
  clientSecret: string,
  accessToken: string
): Promise<boolean> {
  try {
    return await revokeToken({
      clientId,
      clientSecret,
      token: accessToken,
    });
  } catch (err) {
    return classifyAndThrow(err, "revokeAccessToken");
  }
}

// ─── OAuth Config ───

export interface TodoistOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Resolve Todoist OAuth config. Precedence: env vars > global settings.
 * Throws if neither source provides all three required fields.
 */
export async function getTodoistOAuthConfig(): Promise<TodoistOAuthConfig> {
  const envClientId = process.env.TODOIST_CLIENT_ID;
  const envClientSecret = process.env.TODOIST_CLIENT_SECRET;
  const envRedirectUri = process.env.TODOIST_REDIRECT_URI;

  if (envClientId && envClientSecret && envRedirectUri) {
    return { clientId: envClientId, clientSecret: envClientSecret, redirectUri: envRedirectUri };
  }

  const settings = await getGlobalSettings();
  const stored = settings.todoistOAuth;
  if (stored?.clientId && stored?.clientSecret && stored?.redirectUri) {
    return {
      clientId: stored.clientId,
      clientSecret: stored.clientSecret,
      redirectUri: stored.redirectUri,
    };
  }

  throw new Error(
    "Missing Todoist OAuth config. Enter your Todoist app credentials in Settings, or set TODOIST_CLIENT_ID, TODOIST_CLIENT_SECRET, and TODOIST_REDIRECT_URI environment variables."
  );
}
