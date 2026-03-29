import fs from "fs/promises";
import path from "path";
import { OPENSPRINT_DIR } from "@opensprint/shared";
import { createLogger } from "../utils/logger.js";

const log = createLogger("worktree-cleanup-intents");
const INTENTS_SCHEMA_VERSION = 1;
const INTENTS_FILE_NAME = "worktree-cleanup-intents.json";

export interface WorktreeCleanupIntent {
  taskId: string;
  branchName: string;
  worktreePath: string | null;
  gitWorkingMode: "worktree" | "branches";
  worktreeKey?: string;
  createdAt: string;
  reason: "merge_success";
}

interface WorktreeCleanupIntentFile {
  version: number;
  projects: Record<string, Record<string, WorktreeCleanupIntent>>;
}

function intentsFilePath(repoPath: string): string {
  return path.join(repoPath, OPENSPRINT_DIR, "runtime", INTENTS_FILE_NAME);
}

async function readIntentFile(repoPath: string): Promise<WorktreeCleanupIntentFile> {
  try {
    const raw = await fs.readFile(intentsFilePath(repoPath), "utf-8");
    const parsed = JSON.parse(raw) as WorktreeCleanupIntentFile;
    if (parsed?.version !== INTENTS_SCHEMA_VERSION || typeof parsed.projects !== "object") {
      return { version: INTENTS_SCHEMA_VERSION, projects: {} };
    }
    return parsed;
  } catch {
    return { version: INTENTS_SCHEMA_VERSION, projects: {} };
  }
}

async function writeIntentFile(repoPath: string, data: WorktreeCleanupIntentFile): Promise<void> {
  const runtimeDir = path.join(repoPath, OPENSPRINT_DIR, "runtime");
  await fs.mkdir(runtimeDir, { recursive: true });
  const filePath = intentsFilePath(repoPath);
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmpPath, filePath);
}

export class WorktreeCleanupIntentService {
  async register(
    repoPath: string,
    projectId: string,
    intent: Omit<WorktreeCleanupIntent, "createdAt" | "reason">
  ): Promise<void> {
    const data = await readIntentFile(repoPath);
    const projectIntents = data.projects[projectId] ?? {};
    projectIntents[intent.taskId] = {
      ...intent,
      createdAt: new Date().toISOString(),
      reason: "merge_success",
    };
    data.projects[projectId] = projectIntents;
    await writeIntentFile(repoPath, data);
  }

  async list(repoPath: string, projectId: string): Promise<WorktreeCleanupIntent[]> {
    const data = await readIntentFile(repoPath);
    const projectIntents = data.projects[projectId] ?? {};
    return Object.values(projectIntents);
  }

  async remove(repoPath: string, projectId: string, taskId: string): Promise<void> {
    const data = await readIntentFile(repoPath);
    const projectIntents = data.projects[projectId];
    if (!projectIntents || !projectIntents[taskId]) return;
    delete projectIntents[taskId];
    if (Object.keys(projectIntents).length === 0) {
      delete data.projects[projectId];
    } else {
      data.projects[projectId] = projectIntents;
    }
    await writeIntentFile(repoPath, data);
  }

  async clearProject(repoPath: string, projectId: string): Promise<void> {
    const data = await readIntentFile(repoPath);
    if (!data.projects[projectId]) return;
    delete data.projects[projectId];
    await writeIntentFile(repoPath, data);
  }

  async registerBestEffort(
    repoPath: string,
    projectId: string,
    intent: Omit<WorktreeCleanupIntent, "createdAt" | "reason">
  ): Promise<void> {
    try {
      await this.register(repoPath, projectId, intent);
    } catch (err) {
      log.warn("Failed to persist worktree cleanup intent", {
        projectId,
        taskId: intent.taskId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async removeBestEffort(repoPath: string, projectId: string, taskId: string): Promise<void> {
    try {
      await this.remove(repoPath, projectId, taskId);
    } catch (err) {
      log.warn("Failed to remove worktree cleanup intent", {
        projectId,
        taskId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export const worktreeCleanupIntentService = new WorktreeCleanupIntentService();
