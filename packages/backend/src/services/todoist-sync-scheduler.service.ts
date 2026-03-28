/**
 * Polls TodoistSyncService.runSync() on a fixed interval for all active
 * Todoist connections. Uses a boolean lock to prevent overlapping runs.
 *
 * Single-worker assumption (v1): only one backend instance should run this
 * scheduler. No distributed lock is implemented.
 */

import { integrationStore } from "./integration-store.service.js";
import { TodoistSyncService, type TodoistSyncDeps } from "./todoist-sync.service.js";
import { tokenEncryption } from "./token-encryption.service.js";
import { FeedbackService } from "./feedback.service.js";
import { broadcastToProject } from "../websocket/index.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("todoist-sync-scheduler");

const DEFAULT_INTERVAL_MS = 90_000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;
let tickInProgress = false;

function resolveIntervalMs(): number {
  const envVal = process.env.TODOIST_SYNC_INTERVAL_MS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_INTERVAL_MS;
}

function buildSyncService(): TodoistSyncService {
  const feedbackService = new FeedbackService();
  const deps: TodoistSyncDeps = {
    integrationStore,
    submitFeedback: (projectId, body) => feedbackService.submitFeedback(projectId, body),
    tokenEncryption,
    broadcastToProject,
  };
  return new TodoistSyncService(deps);
}

export async function runTodoistSyncTick(
  syncService?: TodoistSyncService,
): Promise<{ connectionId: string; imported: number; errors: number }[]> {
  if (tickInProgress) {
    log.debug("Skipping tick — previous sync still running");
    return [];
  }

  tickInProgress = true;
  const results: { connectionId: string; imported: number; errors: number }[] = [];

  try {
    const connections = await integrationStore.getActiveConnections("todoist");
    if (connections.length === 0) return results;

    const service = syncService ?? buildSyncService();

    for (const connection of connections) {
      try {
        const result = await service.runSync(connection.id);
        results.push({
          connectionId: connection.id,
          imported: result.imported,
          errors: result.errors,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error("Sync failed for connection", {
          connectionId: connection.id,
          error: errMsg,
        });
        results.push({ connectionId: connection.id, imported: 0, errors: 1 });
      }
    }

    if (results.length > 0) {
      const totalImported = results.reduce((sum, r) => sum + r.imported, 0);
      const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
      log.info("Sync tick completed", {
        connections: results.length,
        totalImported,
        totalErrors,
      });
    }
  } catch (err) {
    log.error("Todoist sync tick error", {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    tickInProgress = false;
  }

  return results;
}

export function startTodoistSyncScheduler(): void {
  if (running) {
    log.warn("Todoist sync scheduler already running");
    return;
  }

  const intervalMs = resolveIntervalMs();
  running = true;

  intervalHandle = setInterval(() => {
    void runTodoistSyncTick();
  }, intervalMs);

  log.info("Todoist sync scheduler started", { intervalMs });
}

export function stopTodoistSyncScheduler(): void {
  const wasRunning = running || intervalHandle !== null;
  running = false;

  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }

  if (wasRunning) {
    log.info("Todoist sync scheduler stopped");
  }
}

/** Exposed for testing only. */
export function _isTickInProgress(): boolean {
  return tickInProgress;
}

/** Exposed for testing only — resets internal state. */
export function _resetForTest(): void {
  running = false;
  tickInProgress = false;
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
