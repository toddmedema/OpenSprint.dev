/**
 * Git-based change detection for self-improvement: determines if the project repo
 * has commits or file changes since a given timestamp or commit SHA.
 * Uses server UTC for timestamps.
 */

import { hasGitHead, resolveBaseBranch } from "../utils/git-repo-state.js";
import { shellExec } from "../utils/shell-exec.js";

const GIT_TIMEOUT_MS = 10_000;

export interface HasCodeChangesSinceOptions {
  /** ISO timestamp (UTC) of last self-improvement run. If missing, returns true (first run). */
  sinceTimestamp?: string;
  /** Optional commit SHA from last run; when set, compares HEAD to this SHA on base branch. */
  sinceCommitSha?: string;
  /** Branch to check (e.g. "main"). If missing, resolved via resolveBaseBranch. */
  baseBranch?: string;
}

/**
 * Returns true if the repo has commits or file changes since the given time/SHA;
 * false when no changes. Empty repo (no commits) returns true for first run.
 * Uses server UTC for date interpretation.
 */
export async function hasCodeChangesSince(
  repoPath: string,
  options: HasCodeChangesSinceOptions
): Promise<boolean> {
  const { sinceTimestamp, sinceCommitSha, baseBranch: optionBaseBranch } = options;

  if (!sinceTimestamp && !sinceCommitSha) {
    return true; // missing lastRunAt → treat as first run
  }

  const hasHead = await hasGitHead(repoPath);
  if (!hasHead) {
    return true; // empty repo → first run
  }

  const baseBranch = optionBaseBranch ?? (await resolveBaseBranch(repoPath, null));

  if (sinceCommitSha) {
    try {
      const { stdout } = await shellExec(`git rev-list ${sinceCommitSha}..${baseBranch} --count`, {
        cwd: repoPath,
        timeout: GIT_TIMEOUT_MS,
      });
      const count = parseInt(stdout.trim(), 10);
      return !Number.isNaN(count) && count > 0;
    } catch {
      // SHA not in history or invalid; fall back to timestamp if provided
    }
  }

  if (sinceTimestamp) {
    try {
      const { stdout } = await shellExec(
        `git rev-list ${baseBranch} --after="${sinceTimestamp}" --count`,
        { cwd: repoPath, timeout: GIT_TIMEOUT_MS }
      );
      const count = parseInt(stdout.trim(), 10);
      return !Number.isNaN(count) && count > 0;
    } catch {
      return true; // on error (e.g. invalid date), treat as having changes
    }
  }

  return false;
}
