import fs from "fs/promises";
import path from "path";
import { getGitNoHooksPath } from "../../utils/git-no-hooks.js";
import { runGit, gitNoHooksConfigPrefix } from "../../utils/git-command.js";
import { hasWorkingTreeChanges } from "../../utils/git-repo-state.js";

export const PROJECT_BOOTSTRAP_COMMIT_MESSAGE = "chore: initialize Open Sprint project";

export async function stageAndCommitBootstrapPaths(
  repoPath: string,
  pathsToStage: string[]
): Promise<boolean> {
  const existingPaths: string[] = [];
  for (const relPath of pathsToStage) {
    try {
      await fs.access(path.join(repoPath, relPath));
      existingPaths.push(relPath);
    } catch {
      // File may legitimately not exist in this project shape
    }
  }
  if (existingPaths.length === 0) return false;

  await runGit(["add", "-A", "--", ...existingPaths], { cwd: repoPath });
  const staged = await runGit(["diff", "--cached", "--name-only"], { cwd: repoPath });
  if (!staged.stdout.trim()) return false;
  const noHooks = getGitNoHooksPath();
  await runGit(
    [...gitNoHooksConfigPrefix(noHooks), "commit", "-m", PROJECT_BOOTSTRAP_COMMIT_MESSAGE],
    { cwd: repoPath, timeout: 30_000 }
  );
  return true;
}

export async function commitBootstrapRepoChanges(
  repoPath: string,
  options: { includeWholeRepo: boolean; extraPaths?: string[] }
): Promise<boolean> {
  if (options.includeWholeRepo) {
    const hasChanges = await hasWorkingTreeChanges(repoPath);
    if (!hasChanges) return false;
    await runGit(["add", "-A"], { cwd: repoPath });
    const noHooksBootstrap = getGitNoHooksPath();
    await runGit(
      [
        ...gitNoHooksConfigPrefix(noHooksBootstrap),
        "commit",
        "-m",
        PROJECT_BOOTSTRAP_COMMIT_MESSAGE,
      ],
      { cwd: repoPath, timeout: 30_000 }
    );
    return true;
  }

  return stageAndCommitBootstrapPaths(repoPath, [
    "AGENTS.md",
    ".gitignore",
    "SPEC.md",
    ".opensprint",
    ...(options.extraPaths ?? []),
  ]);
}
