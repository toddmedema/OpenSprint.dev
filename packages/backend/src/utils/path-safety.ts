import fs from "fs";
import os from "node:os";
import path from "path";
import { OPENSPRINT_PATHS } from "@opensprint/shared";

function isPathInsideResolved(
  parentResolved: string,
  candidateResolved: string,
  allowEqual: boolean
): boolean {
  if (parentResolved === candidateResolved) return allowEqual;
  const relative = path.relative(parentResolved, candidateResolved);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function isPathInside(
  parentPath: string,
  candidatePath: string,
  options?: { allowEqual?: boolean }
): boolean {
  return isPathInsideResolved(
    path.resolve(parentPath),
    path.resolve(candidatePath),
    options?.allowEqual ?? true
  );
}

export function assertPathInside(
  parentPath: string,
  candidatePath: string,
  label: string,
  options?: { allowEqual?: boolean }
): string {
  const parentResolved = path.resolve(parentPath);
  const candidateResolved = path.resolve(candidatePath);
  if (!isPathInsideResolved(parentResolved, candidateResolved, options?.allowEqual ?? true)) {
    throw new Error(
      `${label} escapes its allowed root: target=${candidateResolved}, root=${parentResolved}`
    );
  }
  return candidatePath;
}

export function getSafeTaskActiveDir(repoPath: string, taskId: string): string {
  const activeRoot = path.join(repoPath, OPENSPRINT_PATHS.active);
  const activeDir = path.join(activeRoot, taskId);
  return assertPathInside(activeRoot, activeDir, `active dir for task ${taskId}`, {
    allowEqual: false,
  });
}

export function isTaskWorktreePath(taskId: string, candidatePath: string): boolean {
  const resolved = path.resolve(candidatePath);
  const parentBase = path.basename(path.dirname(resolved));
  if (parentBase !== "opensprint-worktrees") return false;
  const basename = path.basename(resolved);
  if (basename === taskId) return true;
  // per_epic: worktree key is epic_<epicId>, taskId is e.g. os-abc.1 (child of epic os-abc)
  if (basename.startsWith("epic_")) {
    const epicId = basename.slice(5);
    return taskId === epicId || taskId.startsWith(epicId + ".");
  }
  return false;
}

function realpathSyncSafe(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

function getTempRoots(): string[] {
  const candidates = [os.tmpdir(), "/tmp", "/private/tmp"];
  const roots = new Set<string>();
  for (const candidate of candidates) {
    roots.add(path.resolve(candidate));
    roots.add(realpathSyncSafe(candidate));
  }
  return [...roots];
}

export function assertSafeTaskWorktreePath(
  repoPath: string,
  taskId: string,
  candidatePath: string
): string {
  const resolvedRepo = path.resolve(repoPath);
  const resolvedCandidate = path.resolve(candidatePath);
  if (resolvedRepo === resolvedCandidate) {
    throw new Error(
      `Refusing to treat the repository root as a disposable worktree: ${resolvedCandidate}`
    );
  }
  if (isTaskWorktreePath(taskId, resolvedCandidate)) {
    return candidatePath;
  }

  /** Git-registered worktrees may live under the OS temp dir (tests, alternate layouts). Never delete paths inside the main repo. */
  const normCandidate = realpathSyncSafe(resolvedCandidate);
  const insideTmp = getTempRoots().some((tmpRoot) =>
    isPathInside(tmpRoot, normCandidate, { allowEqual: false })
  );
  const insideRepo = isPathInside(resolvedRepo, normCandidate, { allowEqual: true });
  if (insideTmp && !insideRepo) {
    return candidatePath;
  }

  throw new Error(
    `Refusing to clean up a path outside opensprint worktrees for task ${taskId}: ${resolvedCandidate}`
  );
}
