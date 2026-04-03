/**
 * GitHub Issues integration routes.
 *
 * POST /connect       — store a user-supplied PAT and activate the connection
 * GET  /status        — returns current integration connection status
 * GET  /repos         — lists repos accessible with the stored PAT
 * PUT  /repo          — selects a GitHub repo for issue sync
 * POST /sync          — manual sync trigger via intake ingestion pipeline
 * DELETE /            — disconnect (delete stored connection)
 */

import { Router, type Request } from "express";
import { z } from "zod";
import { wrapAsync } from "../middleware/wrap-async.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { projectIdParamSchema } from "../schemas/request-common.js";
import type { IntegrationStoreService } from "../services/integration-store.service.js";
import type { TokenEncryptionService } from "../services/token-encryption.service.js";
import type { IntakeIngestionService } from "../services/intake-ingestion.service.js";
import type {
  IntegrationStatusResponse,
  IntegrationSourceOption,
  IntegrationSyncResponse,
} from "@opensprint/shared";
import { createLogger } from "../utils/logger.js";

const log = createLogger("github-integration");

const GITHUB_API = "https://api.github.com";
const SYNC_RATE_LIMIT_MS = 10_000;

const connectBodySchema = z.object({
  token: z.string().min(1, "token is required"),
});

const selectRepoBodySchema = z.object({
  repoId: z.string().min(1, "repoId is required"),
  repoFullName: z.string().min(1, "repoFullName is required"),
});

export interface GitHubIntegrationRouterDeps {
  integrationStore: Pick<
    IntegrationStoreService,
    | "upsertConnection"
    | "getConnection"
    | "getEncryptedTokenById"
    | "updateConnectionStatus"
    | "updateSelectedResource"
    | "deleteConnection"
  >;
  tokenEncryption: Pick<TokenEncryptionService, "encryptToken" | "decryptToken">;
  intakeIngestion?: Pick<IntakeIngestionService, "ingestFromConnection">;
}

type ProjectParams = { projectId: string };

async function verifyGitHubToken(token: string): Promise<{ login: string } | null> {
  try {
    const res = await fetch(`${GITHUB_API}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { login?: string };
    return data.login ? { login: data.login } : null;
  } catch {
    return null;
  }
}

async function listGitHubRepos(
  token: string
): Promise<IntegrationSourceOption[]> {
  const res = await fetch(
    `${GITHUB_API}/user/repos?sort=updated&per_page=100&type=all`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }
  const repos = (await res.json()) as Array<{
    id: number;
    full_name: string;
    open_issues_count?: number;
  }>;
  return repos.map((r) => ({
    id: String(r.id),
    name: r.full_name,
    itemCount: r.open_issues_count,
  }));
}

function tryDecryptToken(
  enc: Pick<TokenEncryptionService, "decryptToken">,
  encryptedToken: string
): string | null {
  try {
    return enc.decryptToken(encryptedToken);
  } catch {
    return null;
  }
}

export function createGitHubIntegrationRouter(
  deps: GitHubIntegrationRouterDeps
): Router {
  const router = Router({ mergeParams: true });
  const { integrationStore, tokenEncryption } = deps;

  // POST /connect
  router.post(
    "/connect",
    validateParams(projectIdParamSchema),
    validateBody(connectBodySchema),
    wrapAsync(async (req: Request<ProjectParams>, res) => {
      const { projectId } = req.params;
      const { token } = req.body as z.infer<typeof connectBodySchema>;

      const user = await verifyGitHubToken(token);
      if (!user) {
        res.status(401).json({
          error: {
            code: "INVALID_TOKEN",
            message:
              "The provided GitHub token is invalid or lacks required permissions.",
          },
        });
        return;
      }

      const encryptedToken = tokenEncryption.encryptToken(token);

      await integrationStore.upsertConnection({
        project_id: projectId,
        provider: "github",
        provider_user_id: user.login,
        access_token_enc: encryptedToken,
        scopes: "repo",
        status: "active",
      });

      log.info("GitHub connected", { projectId, user: user.login });

      res.json({
        data: { success: true, user: user.login },
      });
    })
  );

  // GET /status
  router.get(
    "/status",
    validateParams(projectIdParamSchema),
    wrapAsync(async (req: Request<ProjectParams>, res) => {
      const { projectId } = req.params;
      const connection = await integrationStore.getConnection(
        projectId,
        "github"
      );

      if (!connection) {
        const body: { data: IntegrationStatusResponse } = {
          data: {
            connected: false,
            provider: "github",
            status: "disabled",
          },
        };
        res.json(body);
        return;
      }

      const status: IntegrationStatusResponse = {
        connected: true,
        provider: "github",
        status: connection.status,
      };

      if (connection.provider_user_id) {
        status.user = { id: connection.provider_user_id };
      }

      if (connection.provider_resource_id) {
        status.selectedSource = {
          id: connection.provider_resource_id,
          name:
            connection.provider_resource_name ??
            connection.provider_resource_id,
        };
      }

      if (connection.last_sync_at) {
        status.lastSyncAt = connection.last_sync_at;
      }

      if (connection.last_error) {
        status.lastError = connection.last_error;
      }

      res.json({ data: status });
    })
  );

  // GET /repos
  router.get(
    "/repos",
    validateParams(projectIdParamSchema),
    wrapAsync(async (req: Request<ProjectParams>, res) => {
      const { projectId } = req.params;
      const connection = await integrationStore.getConnection(
        projectId,
        "github"
      );

      if (!connection) {
        res.status(404).json({
          error: {
            code: "NOT_CONNECTED",
            message: "GitHub is not connected for this project.",
          },
        });
        return;
      }

      if (connection.status === "needs_reconnect") {
        res.status(409).json({
          error: {
            code: "NEEDS_RECONNECT",
            message:
              "GitHub connection requires a new token. Please reconnect.",
          },
        });
        return;
      }

      const encryptedToken = await integrationStore.getEncryptedTokenById(
        connection.id
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

      const accessToken = tryDecryptToken(tokenEncryption, encryptedToken);
      if (!accessToken) {
        res.status(500).json({
          error: { code: "TOKEN_DECRYPT_FAILED", message: "Failed to decrypt stored token." },
        });
        return;
      }

      try {
        const repos = await listGitHubRepos(accessToken);
        log.info("Listed GitHub repos", {
          projectId,
          count: repos.length,
        });
        res.json({ data: { repos } });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("401")) {
          await integrationStore.updateConnectionStatus(
            connection.id,
            "needs_reconnect",
            msg
          );
          res.status(401).json({
            error: {
              code: "GITHUB_AUTH_FAILED",
              message:
                "GitHub authentication failed. Please reconnect with a valid token.",
            },
          });
          return;
        }
        throw err;
      }
    })
  );

  // PUT /repo
  router.put(
    "/repo",
    validateParams(projectIdParamSchema),
    validateBody(selectRepoBodySchema),
    wrapAsync(async (req: Request<ProjectParams>, res) => {
      const { projectId } = req.params;
      const { repoId, repoFullName } = req.body as z.infer<
        typeof selectRepoBodySchema
      >;

      const connection = await integrationStore.getConnection(
        projectId,
        "github"
      );
      if (!connection) {
        res.status(404).json({
          error: {
            code: "NOT_CONNECTED",
            message: "GitHub is not connected for this project.",
          },
        });
        return;
      }

      await integrationStore.updateSelectedResource(
        connection.id,
        repoId,
        repoFullName
      );

      log.info("GitHub repo selected", {
        projectId,
        repoId,
        repoFullName,
      });

      res.json({
        data: {
          success: true,
          selectedSource: { id: repoId, name: repoFullName },
        },
      });
    })
  );

  // POST /sync
  router.post(
    "/sync",
    validateParams(projectIdParamSchema),
    wrapAsync(async (req: Request<ProjectParams>, res) => {
      const { projectId } = req.params;
      const connection = await integrationStore.getConnection(
        projectId,
        "github"
      );

      if (!connection) {
        res.status(404).json({
          error: {
            code: "NOT_CONNECTED",
            message: "GitHub is not connected for this project.",
          },
        });
        return;
      }

      if (connection.status === "needs_reconnect") {
        res.status(409).json({
          error: {
            code: "NEEDS_RECONNECT",
            message:
              "GitHub connection requires a new token. Please reconnect.",
          },
        });
        return;
      }

      if (!connection.provider_resource_name) {
        res.status(400).json({
          error: {
            code: "NO_REPO_SELECTED",
            message:
              "No repository selected. Please select a repository before syncing.",
          },
        });
        return;
      }

      if (connection.last_sync_at) {
        const lastSyncMs = new Date(connection.last_sync_at).getTime();
        if (Date.now() - lastSyncMs < SYNC_RATE_LIMIT_MS) {
          res.status(429).json({
            error: {
              code: "SYNC_RATE_LIMITED",
              message:
                "Sync was triggered too recently. Please wait at least 10 seconds between syncs.",
            },
          });
          return;
        }
      }

      if (!deps.intakeIngestion) {
        res.status(500).json({
          error: {
            code: "SYNC_NOT_AVAILABLE",
            message: "Intake ingestion service is not configured.",
          },
        });
        return;
      }

      const ingestionResult = await deps.intakeIngestion.ingestFromConnection(
        connection.id
      );

      log.info("GitHub sync completed", {
        projectId,
        imported: ingestionResult.imported,
        errors: ingestionResult.errors,
      });

      const body: { data: IntegrationSyncResponse } = {
        data: {
          imported: ingestionResult.imported,
          errors: ingestionResult.errors,
        },
      };
      res.json(body);
    })
  );

  // DELETE /
  router.delete(
    "/",
    validateParams(projectIdParamSchema),
    wrapAsync(async (req: Request<ProjectParams>, res) => {
      const { projectId } = req.params;
      const connection = await integrationStore.getConnection(
        projectId,
        "github"
      );

      if (!connection) {
        res.status(404).json({
          error: {
            code: "NOT_CONNECTED",
            message: "GitHub is not connected for this project.",
          },
        });
        return;
      }

      await integrationStore.deleteConnection(projectId, "github");

      log.info("GitHub disconnected", { projectId });

      res.json({ data: { disconnected: true } });
    })
  );

  return router;
}
