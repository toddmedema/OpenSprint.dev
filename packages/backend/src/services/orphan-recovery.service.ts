import { BeadsService, type BeadsIssue } from "./beads.service.js";
import { BranchManager } from "./branch-manager.js";

/**
 * Orphan recovery: detect and retry abandoned IN_PROGRESS tasks.
 * When an agent is killed, its task remains in_progress with no active process.
 * This service finds such tasks, commits any uncommitted work as WIP, and resets
 * them to open so they re-enter the ready queue.
 */
export class OrphanRecoveryService {
  private beads = new BeadsService();
  private branchManager = new BranchManager();

  /**
   * Recover orphaned tasks: in_progress + agent assignee but no active process.
   * For each: commit WIP on task branch if uncommitted changes exist, then reset to open.
   *
   * @param repoPath - Path to the project repository (with .beads)
   * @param excludeTaskId - Optional task ID to exclude (e.g. current task being recovered by crash recovery)
   */
  async recoverOrphanedTasks(
    repoPath: string,
    excludeTaskId?: string | null,
  ): Promise<{ recovered: string[] }> {
    const orphans = await this.beads.listInProgressWithAgentAssignee(repoPath);
    const toRecover = excludeTaskId
      ? orphans.filter((t) => t.id !== excludeTaskId)
      : orphans;

    const recovered: string[] = [];

    for (const task of toRecover) {
      try {
        await this.recoverOne(repoPath, task);
        recovered.push(task.id);
      } catch (err) {
        console.warn(
          `[orphan-recovery] Failed to recover ${task.id}:`,
          (err as Error).message,
        );
      }
    }

    if (recovered.length > 0) {
      console.warn(
        `[orphan-recovery] Recovered ${recovered.length} orphaned task(s): ${recovered.join(", ")}`,
      );
    }

    return { recovered };
  }

  private async recoverOne(repoPath: string, task: BeadsIssue): Promise<void> {
    const branchName = `opensprint/${task.id}`;

    await this.branchManager.waitForGitReady(repoPath);

    try {
      await this.branchManager.checkout(repoPath, branchName);
      await this.branchManager.commitWip(repoPath, task.id);
    } catch {
      // Branch may not exist (task was claimed but branch never created)
      // or checkout may fail — proceed to reset status anyway
    } finally {
      // Return to main so we don't leave repo on a task branch
      try {
        await this.branchManager.ensureOnMain(repoPath);
      } catch {
        // Best effort
      }
    }

    await this.beads.update(repoPath, task.id, {
      status: "open",
      assignee: "",
    });
  }
}

export const orphanRecoveryService = new OrphanRecoveryService();
