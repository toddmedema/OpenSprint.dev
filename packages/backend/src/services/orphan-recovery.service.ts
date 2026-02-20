import fs from "fs/promises";
import { BeadsService, type BeadsIssue } from "./beads.service.js";
import { BranchManager } from "./branch-manager.js";
import { heartbeatService } from "./heartbeat.service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("orphan-recovery");

/** Normalize a single string, array, or nullish value into a Set for exclude checks. */
function toExcludeSet(ids?: string | string[] | null): Set<string> {
  if (!ids) return new Set();
  return new Set(Array.isArray(ids) ? ids : [ids]);
}

/**
 * Orphan recovery: detect and retry abandoned IN_PROGRESS tasks.
 * When an agent is killed, its task remains in_progress with no active process.
 * This service: (1) commits any uncommitted changes on the task branch as WIP,
 * (2) resets the task status to open so it re-enters the ready queue.
 *
 * IMPORTANT: This service never checks out branches. The task branch is preserved
 * on disk (and on the remote if it was pushed). When the task is retried, the
 * worktree-based agent flow will pick up the existing branch.
 */
export class OrphanRecoveryService {
  private beads = new BeadsService();
  private branchManager = new BranchManager();

  /**
   * Recover tasks identified by stale heartbeat files (> 2 min old).
   * Complements recoverOrphanedTasks by finding orphaned worktrees via heartbeat age.
   *
   * @param repoPath - Path to the project repository (with .beads)
   * @param excludeTaskIds - Task ID(s) to exclude from recovery
   */
  async recoverFromStaleHeartbeats(
    repoPath: string,
    excludeTaskIds?: string | string[] | null
  ): Promise<{ recovered: string[] }> {
    const excludeSet = toExcludeSet(excludeTaskIds);
    const worktreeBase = this.branchManager.getWorktreeBasePath();
    const stale = await heartbeatService.findStaleHeartbeats(worktreeBase);
    const recovered: string[] = [];

    for (const { taskId } of stale) {
      if (excludeSet.has(taskId)) continue;
      try {
        const task = await this.beads.show(repoPath, taskId);
        if (task.status === "in_progress") {
          await this.recoverOne(repoPath, task);
          recovered.push(taskId);
        }
      } catch {
        // Task may not exist in beads — just clean up worktree
        try {
          await this.branchManager.removeTaskWorktree(repoPath, taskId);
        } catch {
          // Ignore
        }
      }
    }

    return { recovered };
  }

  /**
   * Recover orphaned tasks: in_progress + agent assignee but no active process.
   * Resets each task to open without any git checkout operations.
   * The branch is preserved for the next agent attempt.
   *
   * @param repoPath - Path to the project repository (with .beads)
   * @param excludeTaskIds - Task ID(s) to exclude (e.g. currently active agent tasks)
   */
  async recoverOrphanedTasks(
    repoPath: string,
    excludeTaskIds?: string | string[] | null
  ): Promise<{ recovered: string[] }> {
    const excludeSet = toExcludeSet(excludeTaskIds);
    const orphans = await this.beads.listInProgressWithAgentAssignee(repoPath);
    const toRecover = orphans.filter((t) => !excludeSet.has(t.id));

    const recovered: string[] = [];

    for (const task of toRecover) {
      try {
        await this.recoverOne(repoPath, task);
        recovered.push(task.id);
      } catch (err) {
        log.warn("Failed to recover task", { taskId: task.id, err: (err as Error).message });
      }
    }

    if (recovered.length > 0) {
      log.warn("Recovered orphaned tasks", { count: recovered.length, recovered });
    }

    return { recovered };
  }

  private async recoverOne(repoPath: string, task: BeadsIssue): Promise<void> {
    const wtPath = this.branchManager.getWorktreePath(task.id);
    try {
      await fs.access(wtPath);
      // Worktree exists — commit any uncommitted changes as WIP before removing
      await this.branchManager.commitWip(wtPath, task.id);
    } catch {
      // Worktree may not exist — that's fine
    }

    // Clean up any stale worktree for this task (safe no-op if none exists)
    try {
      await this.branchManager.removeTaskWorktree(repoPath, task.id);
    } catch {
      // Worktree may not exist
    }

    // Reset task status to open — no git checkout needed.
    // The branch is preserved for the next attempt.
    await this.beads.update(repoPath, task.id, {
      status: "open",
      assignee: "",
    });
  }
}

export const orphanRecoveryService = new OrphanRecoveryService();
