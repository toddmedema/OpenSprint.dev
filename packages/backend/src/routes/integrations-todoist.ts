/**
 * Todoist integration routes.
 *
 * POST /oauth/start    — generates authorization URL and stores state server-side
 * GET  /oauth/callback — validates state, exchanges code for token, stores connection
 * GET  /status         — returns current integration connection status
 * GET  /projects       — lists Todoist projects using stored token
 */

import { Router, type Request } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { wrapAsync } from "../middleware/wrap-async.js";
import { validateParams, validateQuery } from "../middleware/validate.js";
import { projectIdParamSchema } from "../schemas/request-common.js";
import {
  generateOAuthState,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  getTodoistOAuthConfig,
  TodoistApiClient,
  TodoistAuthError,
  TodoistRateLimitError,
} from "../services/todoist-api-client.service.js";
import type { IntegrationStoreService } from "../services/integration-store.service.js";
import type { TokenEncryptionService } from "../services/token-encryption.service.js";
import type { Permission } from "@doist/todoist-api-typescript";
import type {
  TodoistOAuthStartResponse,
  TodoistIntegrationStatus,
} from "@opensprint/shared";
import { createLogger } from "../utils/logger.js";

const log = createLogger("todoist-oauth");

const OAUTH_SCOPES: readonly Permission[] = ["data:read_write", "data:delete"];
const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const STATE_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

interface StoredOAuthState {
  projectId: string;
  expiresAt: number;
}

function getOAuthStateFilePath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(home, ".opensprint", "todoist-oauth-states.json");
}

/**
 * File-backed OAuth state store with in-memory cache and TTL cleanup.
 * Survives backend restarts so in-flight OAuth callbacks still validate.
 */
export class OAuthStateStore {
  private states = new Map<string, StoredOAuthState>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly filePath: string;
  private readonly now: () => number;

  constructor(filePath = getOAuthStateFilePath(), now: () => number = () => Date.now()) {
    this.filePath = filePath;
    this.now = now;
    this.loadFromDisk();
    this.pruneExpired();
    if (this.states.size > 0) {
      this.ensureCleanup();
    }
  }

  private loadFromDisk(): void {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, StoredOAuthState>;
      for (const [state, entry] of Object.entries(parsed)) {
        if (
          entry &&
          typeof entry.projectId === "string" &&
          typeof entry.expiresAt === "number"
        ) {
          this.states.set(state, entry);
        }
      }
    } catch {
      // File missing or malformed: start with empty state map.
    }
  }

  private persistToDisk(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const payload = JSON.stringify(Object.fromEntries(this.states), null, 2);
    fs.writeFileSync(this.filePath, payload, "utf8");
  }

  private pruneExpired(): void {
    const now = this.now();
    let changed = false;
    for (const [key, entry] of this.states) {
      if (now > entry.expiresAt) {
        this.states.delete(key);
        changed = true;
      }
    }
    if (changed) {
      this.persistToDisk();
    }
  }

  store(state: string, projectId: string): void {
    this.pruneExpired();
    this.states.set(state, {
      projectId,
      expiresAt: this.now() + STATE_TTL_MS,
    });
    this.persistToDisk();
    this.ensureCleanup();
  }

  /**
   * Validates and consumes a state token. Returns the associated projectId
   * if valid and not expired, otherwise null.
   */
  consume(state: string): string | null {
    this.pruneExpired();
    const entry = this.states.get(state);
    if (!entry) return null;
    this.states.delete(state);
    this.persistToDisk();
    if (this.now() > entry.expiresAt) return null;
    return entry.projectId;
  }

  private ensureCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.pruneExpired();
      if (this.states.size === 0 && this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
    }, STATE_CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer && typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  /** Exposed for testing. */
  get size(): number {
    return this.states.size;
  }

  /** Tear down the cleanup timer (for test isolation). */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.states.clear();
    try {
      fs.rmSync(this.filePath, { force: true });
    } catch {
      // Ignore cleanup failure in tests/shutdown paths.
    }
  }

  /** Exposed for testing. */
  forceExpireForTest(state: string): void {
    const entry = this.states.get(state);
    if (!entry) return;
    this.states.set(state, { ...entry, expiresAt: this.now() - 1 });
    this.persistToDisk();
  }
}

export const oauthStateStore = new OAuthStateStore();

const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1, "code is required"),
  state: z.string().min(1, "state is required"),
});

export interface TodoistIntegrationRouterDeps {
  integrationStore: Pick<
    IntegrationStoreService,
    "upsertConnection" | "getConnection" | "getEncryptedTokenById" | "updateConnectionStatus"
  >;
  tokenEncryption: Pick<TokenEncryptionService, "encryptToken" | "decryptToken">;
}

type ProjectParams = { projectId: string };

export function createTodoistIntegrationRouter(
  deps: TodoistIntegrationRouterDeps,
): Router {
  const router = Router({ mergeParams: true });
  const { integrationStore, tokenEncryption } = deps;

  // POST /oauth/start
  router.post(
    "/oauth/start",
    validateParams(projectIdParamSchema),
    wrapAsync(async (req: Request<ProjectParams>, res) => {
      let config;
      try {
        config = getTodoistOAuthConfig();
      } catch {
        log.error("Todoist OAuth not configured — missing env vars");
        res.status(500).json({
          error: {
            code: "INTEGRATION_NOT_CONFIGURED",
            message:
              "Todoist OAuth is not configured. Set TODOIST_CLIENT_ID, TODOIST_CLIENT_SECRET, and TODOIST_REDIRECT_URI.",
          },
        });
        return;
      }

      const { projectId } = req.params;
      const state = generateOAuthState();
      oauthStateStore.store(state, projectId);

      const authorizationUrl = buildAuthorizationUrl(
        config.clientId,
        OAUTH_SCOPES,
        state,
      );

      log.info("OAuth flow started", { projectId });

      const body: { data: TodoistOAuthStartResponse } = {
        data: { authorizationUrl },
      };
      res.json(body);
    }),
  );

  // GET /oauth/callback
  router.get(
    "/oauth/callback",
    validateQuery(oauthCallbackQuerySchema),
    wrapAsync(async (req, res) => {
      const { code, state } = req.query as { code: string; state: string };

      const projectId = oauthStateStore.consume(state);
      if (!projectId) {
        log.warn("OAuth callback with invalid or expired state");
        res.status(400).json({
          error: {
            code: "INVALID_OAUTH_STATE",
            message: "Invalid or expired OAuth state. Please try connecting again.",
          },
        });
        return;
      }

      let config;
      try {
        config = getTodoistOAuthConfig();
      } catch {
        res.status(500).json({
          error: {
            code: "INTEGRATION_NOT_CONFIGURED",
            message: "Todoist OAuth is not configured.",
          },
        });
        return;
      }

      const { accessToken } = await exchangeCodeForToken(
        config.clientId,
        config.clientSecret,
        code,
      );

      const encryptedToken = tokenEncryption.encryptToken(accessToken);

      let providerUserId: string | null = null;
      const providerUserEmail: string | null = null;

      try {
        const client = new TodoistApiClient(accessToken);
        const projects = await client.getProjects();
        if (projects.length > 0) {
          providerUserId = "todoist-user";
        }
      } catch (err) {
        log.warn("Failed to fetch Todoist user info after OAuth", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      await integrationStore.upsertConnection({
        project_id: projectId,
        provider: "todoist",
        provider_user_id: providerUserId,
        provider_user_email: providerUserEmail,
        access_token_enc: encryptedToken,
        scopes: OAUTH_SCOPES.join(","),
        status: "active",
      });

      log.info("OAuth flow completed — connection stored", { projectId });

      const redirectUrl = config.redirectUri.replace(
        /\/api\/.*$/,
        `/projects/${projectId}/settings?integration=todoist&status=success`,
      );

      const isApiClient =
        req.headers.accept?.includes("application/json") ?? false;
      if (isApiClient) {
        res.json({ data: { success: true, projectId } });
      } else {
        res.redirect(redirectUrl);
      }
    }),
  );

  // GET /status
  router.get(
    "/status",
    validateParams(projectIdParamSchema),
    wrapAsync(async (req: Request<ProjectParams>, res) => {
      const { projectId } = req.params;
      const connection = await integrationStore.getConnection(projectId, "todoist");

      if (!connection) {
        const body: { data: TodoistIntegrationStatus } = {
          data: { connected: false, status: "disabled" },
        };
        res.json(body);
        return;
      }

      const status: TodoistIntegrationStatus = {
        connected: true,
        status: connection.status,
      };

      if (connection.provider_user_id) {
        status.todoistUser = {
          id: connection.provider_user_id,
          ...(connection.provider_user_email
            ? { email: connection.provider_user_email }
            : {}),
        };
      }

      if (connection.provider_resource_id) {
        status.selectedProject = {
          id: connection.provider_resource_id,
          name: connection.provider_resource_name ?? connection.provider_resource_id,
        };
      }

      if (connection.last_sync_at) {
        status.lastSyncAt = connection.last_sync_at;
      }

      if (connection.last_error) {
        status.lastError = connection.last_error;
      }

      log.info("Returned integration status", { projectId, connected: true });
      res.json({ data: status });
    }),
  );

  // GET /projects
  router.get(
    "/projects",
    validateParams(projectIdParamSchema),
    wrapAsync(async (req: Request<ProjectParams>, res) => {
      const { projectId } = req.params;
      const connection = await integrationStore.getConnection(projectId, "todoist");

      if (!connection) {
        res.status(404).json({
          error: {
            code: "NOT_CONNECTED",
            message: "Todoist is not connected for this project.",
          },
        });
        return;
      }

      if (connection.status === "needs_reconnect") {
        res.status(409).json({
          error: {
            code: "NEEDS_RECONNECT",
            message:
              "Todoist connection requires re-authentication. Please reconnect.",
          },
        });
        return;
      }

      const encryptedToken = await integrationStore.getEncryptedTokenById(
        connection.id,
      );
      if (!encryptedToken) {
        res.status(500).json({
          error: {
            code: "TOKEN_MISSING",
            message: "Stored token could not be retrieved.",
          },
        });
        return;
      }

      let accessToken: string;
      try {
        accessToken = tokenEncryption.decryptToken(encryptedToken);
      } catch {
        res.status(500).json({
          error: {
            code: "TOKEN_DECRYPT_FAILED",
            message: "Failed to decrypt stored token.",
          },
        });
        return;
      }

      try {
        const client = new TodoistApiClient(accessToken);
        const projects = await client.getProjects();
        log.info("Listed Todoist projects", { projectId, count: projects.length });
        res.json({ data: { projects } });
      } catch (err) {
        if (err instanceof TodoistAuthError) {
          await integrationStore.updateConnectionStatus(
            connection.id,
            "needs_reconnect",
            err.message,
          );
          log.warn("Todoist auth failed — marked needs_reconnect", { projectId });
          res.status(401).json({
            error: {
              code: "TODOIST_AUTH_FAILED",
              message:
                "Todoist authentication failed. Please reconnect your account.",
            },
          });
          return;
        }

        if (err instanceof TodoistRateLimitError) {
          log.warn("Todoist rate limit hit", {
            projectId,
            retryAfter: err.retryAfter,
          });
          res.set("Retry-After", String(err.retryAfter));
          res.status(429).json({
            error: {
              code: "RATE_LIMITED",
              message: "Todoist API rate limit exceeded. Please try again later.",
              retryAfter: err.retryAfter,
            },
          });
          return;
        }

        throw err;
      }
    }),
  );

  return router;
}
