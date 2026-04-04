import { createLogger } from "../../utils/logger.js";
import { BranchManager } from "../branch-manager.js";

const log = createLogger("project-lifecycle");

export async function stopOrchestratorForProject(projectId: string): Promise<void> {
  try {
    const { orchestratorService } = await import("../orchestrator.service.js");
    orchestratorService.stopProject(projectId);
  } catch (error) {
    log.warn("Failed to stop orchestrator during project cleanup", {
      projectId,
      error,
    });
  }
}

export async function cleanupProjectWorktrees(repoPath: string): Promise<void> {
  const branchManager = new BranchManager();
  let removed = 0;
  let failed = 0;
  try {
    const worktrees = await branchManager.listTaskWorktrees(repoPath);
    for (const { taskId, worktreePath } of worktrees) {
      try {
        await branchManager.prepareWorktreeForRemoval(taskId);
        await branchManager.removeTaskWorktree(repoPath, taskId, worktreePath);
        removed += 1;
      } catch {
        failed += 1;
      }
    }
  } catch {
    // Repo may not exist or have no worktrees
  }
  if (removed > 0 || failed > 0) {
    log.info("Project worktree cleanup completed", { repoPath, removed, failed });
  }
}
