/**
 * Independent watchdog service (Witness Pattern).
 *
 * Runs on its own timer, separate from the orchestrator's main loop, to detect
 * and recover from failure conditions that the orchestrator itself can't see:
 *  - Stale agent heartbeats (agent hung/crashed without clean exit)
 *  - Orphaned in_progress tasks (no active process)
 *  - Stale .git/index.lock files
 *
 * Started alongside the orchestrator from index.ts.
 */

import fs from "fs/promises";
import path from "path";
import { HEARTBEAT_STALE_MS } from "@opensprint/shared";
import { BranchManager } from "./branch-manager.js";
import { heartbeatService } from "./heartbeat.service.js";
import { orphanRecoveryService } from "./orphan-recovery.service.js";
import { activeAgentsService } from "./active-agents.service.js";
import { eventLogService } from "./event-log.service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("watchdog");
const WATCHDOG_POLL_MS = 5 * 60 * 1000; // 5 minutes
const GIT_LOCK_STALE_MS = 10 * 60 * 1000; // 10 minutes

interface WatchdogTarget {
  projectId: string;
  repoPath: string;
}

export class WatchdogService {
  private interval: NodeJS.Timeout | null = null;
  private branchManager = new BranchManager();
  private targets: WatchdogTarget[] = [];

  start(targets: WatchdogTarget[]): void {
    if (this.interval) return;
    this.targets = targets;

    this.interval = setInterval(() => {
      this.runChecks().catch((err) => {
        log.warn("Check cycle failed", { err });
      });
    }, WATCHDOG_POLL_MS);

    log.info("Started", {
      intervalSec: WATCHDOG_POLL_MS / 1000,
      projectCount: targets.length,
    });
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async runChecks(): Promise<void> {
    for (const target of this.targets) {
      try {
        await this.checkAgentHealth(target);
        await this.checkOrphanedTasks(target);
        await this.checkGitLockHealth(target);
      } catch (err) {
        log.warn("Checks failed for project", { projectId: target.projectId, err });
      }
    }
  }

  /**
   * Detect stale heartbeats — agents that appear to have died without
   * the orchestrator noticing (e.g. SIGKILL, OOM).
   */
  private async checkAgentHealth(target: WatchdogTarget): Promise<void> {
    const worktreeBase = this.branchManager.getWorktreeBasePath();
    const stale = await heartbeatService.findStaleHeartbeats(worktreeBase);

    for (const { taskId, heartbeat } of stale) {
      const staleSec = Math.round((Date.now() - heartbeat.lastOutputTimestamp) / 1000);
      log.warn("Stale heartbeat", { taskId, staleSec });

      eventLogService
        .append(target.repoPath, {
          timestamp: new Date().toISOString(),
          projectId: target.projectId,
          taskId,
          event: "watchdog.stale_heartbeat",
          data: { staleSec, threshold: HEARTBEAT_STALE_MS / 1000 },
        })
        .catch(() => {});
    }
  }

  /**
   * Periodic orphan recovery (not just on startup).
   * Catches tasks that slip through crash recovery.
   * Excludes tasks with actively running agents to avoid sabotaging in-flight work.
   */
  private async checkOrphanedTasks(target: WatchdogTarget): Promise<void> {
    const activeAgents = activeAgentsService.list(target.projectId);
    const activeTaskIds = activeAgents.map((a) => a.id);
    const { recovered } = await orphanRecoveryService.recoverOrphanedTasks(
      target.repoPath,
      activeTaskIds
    );
    if (recovered.length > 0) {
      log.warn("Recovered orphaned tasks", { count: recovered.length, recovered });

      eventLogService
        .append(target.repoPath, {
          timestamp: new Date().toISOString(),
          projectId: target.projectId,
          taskId: "",
          event: "watchdog.orphan_recovery",
          data: { recovered },
        })
        .catch(() => {});
    }
  }

  /**
   * Detect and remove stale .git/index.lock files that prevent git operations.
   */
  private async checkGitLockHealth(target: WatchdogTarget): Promise<void> {
    const lockPath = path.join(target.repoPath, ".git", "index.lock");
    try {
      const stat = await fs.stat(lockPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs > GIT_LOCK_STALE_MS) {
        log.warn("Removing stale .git/index.lock", { ageSec: Math.round(ageMs / 1000) });
        await fs.unlink(lockPath);

        eventLogService
          .append(target.repoPath, {
            timestamp: new Date().toISOString(),
            projectId: target.projectId,
            taskId: "",
            event: "watchdog.stale_lock_removed",
            data: { ageMs },
          })
          .catch(() => {});
      }
    } catch {
      // No lock file — healthy
    }
  }
}

export const watchdogService = new WatchdogService();
