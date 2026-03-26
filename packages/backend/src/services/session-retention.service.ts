/**
 * Hourly cleanup job for agent_sessions and orchestrator_events retention.
 * Keeps only the 100 most recent rows in each table; prunes older entries and runs VACUUM.
 * Active/in-progress sessions are not in agent_sessions until archived, so no impact.
 */

import { taskStore } from "./task-store.service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("session-retention");
const RETENTION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export class SessionRetentionService {
  private interval: NodeJS.Timeout | null = null;

  start(): void {
    if (this.interval) return;

    this.interval = setInterval(() => {
      this.runCleanup().catch((err) => {
        log.warn("Session retention cleanup failed", { err });
      });
    }, RETENTION_INTERVAL_MS);

    log.info("Started", { intervalSec: RETENTION_INTERVAL_MS / 1000 });
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async runCleanup(): Promise<void> {
    let firstError: unknown;
    try {
      const pruned = await taskStore.pruneAgentSessions();
      if (pruned > 0) {
        log.info("Session retention completed", { pruned });
      }
    } catch (err) {
      log.warn("Session retention error", { err });
      firstError = err;
    }
    try {
      const prunedEvents = await taskStore.pruneOrchestratorEvents();
      if (prunedEvents > 0) {
        log.info("Orchestrator event retention completed", { pruned: prunedEvents });
      }
    } catch (err) {
      log.warn("Orchestrator event retention error", { err });
      firstError = firstError ?? err;
    }
    if (firstError) throw firstError;
  }
}

export const sessionRetentionService = new SessionRetentionService();
