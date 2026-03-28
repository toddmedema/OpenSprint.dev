/**
 * OAuth start and callback routes for Todoist integration.
 *
 * POST /oauth/start  — generates authorization URL and stores state server-side
 * GET  /oauth/callback — validates state, exchanges code for token, stores connection
 */

import { Router, type Request } from "express";
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
} from "../services/todoist-api-client.service.js";
import type { IntegrationStoreService } from "../services/integration-store.service.js";
import type { TokenEncryptionService } from "../services/token-encryption.service.js";
import type { Permission } from "@doist/todoist-api-typescript";
import type { TodoistOAuthStartResponse } from "@opensprint/shared";
import { createLogger } from "../utils/logger.js";

const log = createLogger("todoist-oauth");

const OAUTH_SCOPES: readonly Permission[] = ["data:read_write", "data:delete"];
const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const STATE_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

interface StoredOAuthState {
  projectId: string;
  expiresAt: number;
}

/** In-memory store for pending OAuth states with TTL cleanup. */
class OAuthStateStore {
  private states = new Map<string, StoredOAuthState>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  store(state: string, projectId: string): void {
    this.states.set(state, {
      projectId,
      expiresAt: Date.now() + STATE_TTL_MS,
    });
    this.ensureCleanup();
  }

  /**
   * Validates and consumes a state token. Returns the associated projectId
   * if valid and not expired, otherwise null.
   */
  consume(state: string): string | null {
    const entry = this.states.get(state);
    if (!entry) return null;
    this.states.delete(state);
    if (Date.now() > entry.expiresAt) return null;
    return entry.projectId;
  }

  private ensureCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.states) {
        if (now > entry.expiresAt) this.states.delete(key);
      }
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
  }
}

export const oauthStateStore = new OAuthStateStore();

const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1, "code is required"),
  state: z.string().min(1, "state is required"),
});

export interface TodoistIntegrationRouterDeps {
  integrationStore: Pick<IntegrationStoreService, "upsertConnection">;
  tokenEncryption: Pick<TokenEncryptionService, "encryptToken">;
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

  return router;
}
