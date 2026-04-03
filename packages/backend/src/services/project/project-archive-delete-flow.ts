import fs from "fs/promises";
import path from "path";
import type { Project } from "@opensprint/shared";
import { OPENSPRINT_DIR } from "@opensprint/shared";
import { AppError } from "../../middleware/error-handler.js";
import { ErrorCodes } from "../../middleware/error-codes.js";
import { getErrorMessage } from "../../utils/error-utils.js";
import * as projectIndex from "../project-index.js";
import { deleteSettingsFromStore } from "../settings-store.service.js";
import { deleteFeedbackAssetsForProject } from "../feedback-store.service.js";
import { worktreeCleanupIntentService } from "../worktree-cleanup-intent.service.js";
import {
  cleanupProjectWorktrees,
  stopOrchestratorForProject,
} from "./project-lifecycle-operations.js";

export type ArchiveProjectFlowDeps = {
  getProject: (id: string) => Promise<Project>;
  invalidateListCache: () => void;
  taskStore: { deleteOpenQuestionsByProjectId: (projectId: string) => Promise<unknown> };
  invalidateProjectGitRuntime: (projectId: string) => void;
};

export async function runArchiveProjectFlow(deps: ArchiveProjectFlowDeps, id: string): Promise<void> {
  const project = await deps.getProject(id);
  const repoPath = project.repoPath;
  await stopOrchestratorForProject(id);
  await cleanupProjectWorktrees(repoPath);
  await worktreeCleanupIntentService.clearProject(repoPath, id).catch(() => {});
  await deps.taskStore.deleteOpenQuestionsByProjectId(id);
  await projectIndex.removeProject(id);
  deps.invalidateListCache();
  deps.invalidateProjectGitRuntime(id);
}

export type DeleteProjectFlowDeps = ArchiveProjectFlowDeps & {
  taskStore: ArchiveProjectFlowDeps["taskStore"] & {
    deleteByProjectId: (projectId: string) => Promise<unknown>;
  };
};

export async function runDeleteProjectFlow(deps: DeleteProjectFlowDeps, id: string): Promise<void> {
  const project = await deps.getProject(id);
  const repoPath = project.repoPath;
  await stopOrchestratorForProject(id);

  await cleanupProjectWorktrees(repoPath);
  await worktreeCleanupIntentService.clearProject(repoPath, id).catch(() => {});

  await deps.taskStore.deleteByProjectId(id);
  await deleteSettingsFromStore(id);
  await deleteFeedbackAssetsForProject(id);

  const opensprintPath = path.join(repoPath, OPENSPRINT_DIR);
  try {
    await fs.rm(opensprintPath, { recursive: true, force: true });
  } catch (err) {
    const msg = getErrorMessage(err);
    throw new AppError(500, ErrorCodes.INTERNAL_ERROR, `Failed to delete project data: ${msg}`, {
      projectId: id,
      repoPath,
    });
  }

  await projectIndex.removeProject(id);
  deps.invalidateListCache();
  deps.invalidateProjectGitRuntime(id);
}
