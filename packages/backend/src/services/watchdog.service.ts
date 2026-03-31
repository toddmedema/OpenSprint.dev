/**
 * Independent watchdog service (Witness Pattern).
 *
 * Thin timer wrapper around RecoveryService. Periodically runs recovery checks
 * for all registered projects. Started alongside the orchestrator from index.ts.
 *
 * The 5-min patrol includes: stale heartbeats, orphaned tasks (in_progress with
 * agent assignee but no running process — those are reset so the orchestrator
 * can pick them up again), stale .git/index.lock removal, and slot reconciliation.
 * Human-assigned tasks are never reset.
 */

import { recoveryService, type RecoveryHost } from "./recovery.service.js";
import { orchestratorService } from "./orchestrator.service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("watchdog");
const WATCHDOG_POLL_MS = 5 * 60 * 1000; // 5 minutes

export interface WatchdogTarget {
  projectId: string;
  repoPath: string;
}

export class WatchdogService {
  private interval: NodeJS.Timeout | null = null;
  private getTargets: (() => Promise<WatchdogTarget[]>) | null = null;

  /**
   * Start the watchdog. Targets are refreshed from getTargets at the start of each
   * cycle, so deleted/archived projects are never patrolled.
   */
  start(getTargets: () => Promise<WatchdogTarget[]>): void {
    if (this.interval) return;
    this.getTargets = getTargets;

    this.interval = setInterval(() => {
      this.runChecks().catch((err) => {
        log.warn("Check cycle failed", { err });
      });
    }, WATCHDOG_POLL_MS);

    log.info("Started", { intervalSec: WATCHDOG_POLL_MS / 1000 });
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.getTargets = null;
  }

  private async runChecks(): Promise<void> {
    const getTargets = this.getTargets;
    if (!getTargets) return;
    const targets = await getTargets();
    for (const target of targets) {
      try {
        const host: RecoveryHost = orchestratorService.getRecoveryHost();
        const result = await recoveryService.runFullRecovery(
          target.projectId,
          target.repoPath,
          host
        );
        const total = result.requeued.length + result.reattached.length + result.cleaned.length;
        if (total > 0) {
          log.warn("Recovered tasks", {
            projectId: target.projectId,
            requeuedCount: result.requeued.length,
            reattachedCount: result.reattached.length,
            cleanedCount: result.cleaned.length,
            requeued: result.requeued,
            reattached: result.reattached,
            cleaned: result.cleaned,
          });
        }
      } catch (err) {
        log.warn("Checks failed for project", { projectId: target.projectId, err });
      }
    }
  }
}

export const watchdogService = new WatchdogService();
