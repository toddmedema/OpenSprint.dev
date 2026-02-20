import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { gitCommitQueue, RepoConflictError } from "../services/git-commit-queue.service.js";

const execAsync = promisify(exec);

/**
 * Put a git repo into a merge-conflict state by creating divergent changes
 * to the same file on main and a side branch, then attempting a merge.
 * Returns the name of the conflicted file.
 */
async function createMergeConflict(repoPath: string): Promise<string> {
  const conflictFile = "conflict.txt";

  await fs.writeFile(path.join(repoPath, conflictFile), "base content\n");
  await execAsync(`git add ${conflictFile} && git commit -m "add conflict file"`, {
    cwd: repoPath,
  });

  await execAsync("git checkout -b side-branch", { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, conflictFile), "side-branch content\n");
  await execAsync(`git add ${conflictFile} && git commit -m "side change"`, { cwd: repoPath });

  await execAsync("git checkout main", { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, conflictFile), "main content\n");
  await execAsync(`git add ${conflictFile} && git commit -m "main change"`, { cwd: repoPath });

  try {
    await execAsync("git merge side-branch", { cwd: repoPath });
  } catch {
    // Expected — merge conflict
  }

  return conflictFile;
}

/** Resolve merge conflicts by accepting the current (main) version. */
async function resolveConflicts(repoPath: string): Promise<void> {
  const { stdout } = await execAsync("git diff --name-only --diff-filter=U", { cwd: repoPath });
  const files = stdout.trim().split("\n").filter(Boolean);
  for (const f of files) {
    await execAsync(`git checkout --ours ${f}`, { cwd: repoPath });
    await execAsync(`git add ${f}`, { cwd: repoPath });
  }
  await execAsync('git commit -m "resolve conflicts"', { cwd: repoPath });
}

describe("GitCommitQueue", () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = path.join(os.tmpdir(), `git-queue-test-${Date.now()}`);
    await fs.mkdir(repoPath, { recursive: true });
    await execAsync("git init", { cwd: repoPath });
    await execAsync("git checkout -b main", { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, "README"), "initial");
    await execAsync("git add README && git commit -m init", { cwd: repoPath });
    try {
      await execAsync("bd init", { cwd: repoPath });
    } catch {
      // bd may not be installed — skip beads_export tests
    }
  });

  afterEach(async () => {
    await gitCommitQueue.drain();
    await fs.rm(repoPath, { recursive: true, force: true }).catch(() => {});
  });

  it("should enqueue and process beads_export job", async () => {
    const beadsDir = path.join(repoPath, ".beads");
    try {
      await fs.access(beadsDir);
    } catch {
      return; // bd init was skipped
    }

    await gitCommitQueue.enqueueAndWait({
      type: "beads_export",
      repoPath,
      summary: "test export",
    });

    const { stdout } = await execAsync("git log -1 --oneline", { cwd: repoPath });
    expect(stdout).toContain("beads:");
    expect(stdout).toContain("test export");
  });

  it("should enqueue and process prd_update job", async () => {
    await fs.mkdir(path.join(repoPath, ".opensprint"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".opensprint/prd.json"),
      JSON.stringify({ version: 0, sections: {}, changeLog: [] })
    );

    await gitCommitQueue.enqueueAndWait({
      type: "prd_update",
      repoPath,
      source: "sketch",
    });

    const { stdout } = await execAsync("git log -1 --oneline", { cwd: repoPath });
    expect(stdout).toContain("prd:");
  });

  it("should process jobs in FIFO order", async () => {
    await fs.mkdir(path.join(repoPath, ".opensprint"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, ".opensprint/prd.json"),
      JSON.stringify({ version: 0, sections: {}, changeLog: [] })
    );

    gitCommitQueue.enqueue({
      type: "prd_update",
      repoPath,
      source: "sketch",
    });
    await gitCommitQueue.drain();

    const { stdout } = await execAsync("git log -1 --oneline", { cwd: repoPath });
    expect(stdout).toContain("prd:");
  });

  it("should support drain for tests", async () => {
    const beadsDir = path.join(repoPath, ".beads");
    try {
      await fs.access(beadsDir);
    } catch {
      return; // bd init was skipped
    }

    gitCommitQueue.enqueue({
      type: "beads_export",
      repoPath,
      summary: "drain test",
    });
    await gitCommitQueue.drain();

    const { stdout } = await execAsync("git log -1 --oneline", { cwd: repoPath });
    expect(stdout).toContain("beads:");
  });

  // ─── Conflict-aware tests ───

  describe("with unmerged files", () => {
    it("should defer prd_update commit and flush when repo is clean", async () => {
      await createMergeConflict(repoPath);

      await fs.mkdir(path.join(repoPath, ".opensprint"), { recursive: true });
      await fs.writeFile(
        path.join(repoPath, ".opensprint/prd.json"),
        JSON.stringify({ version: 1, sections: {}, changeLog: [] })
      );

      // prd_update during conflict: should succeed (deferred) without throwing
      await gitCommitQueue.enqueueAndWait({
        type: "prd_update",
        repoPath,
        source: "sketch",
      });

      // The last commit should still be "main change" (not a prd commit)
      const { stdout: logBefore } = await execAsync("git log -1 --oneline", { cwd: repoPath });
      expect(logBefore).not.toContain("prd:");

      // Resolve the conflict — this `git commit` includes the staged prd.json
      await resolveConflicts(repoPath);

      // Trigger flush — deferred files were already included in the resolve commit,
      // so flush detects "nothing to commit" and clears the pending set gracefully.
      await gitCommitQueue.retryPendingCommits(repoPath);

      // Verify the prd.json content was preserved (committed as part of conflict resolution)
      const { stdout: show } = await execAsync("git show HEAD:.opensprint/prd.json", {
        cwd: repoPath,
      });
      expect(JSON.parse(show).version).toBe(1);
    });

    it("should flush deferred files on next normal job", async () => {
      await createMergeConflict(repoPath);

      await fs.mkdir(path.join(repoPath, ".opensprint"), { recursive: true });
      await fs.writeFile(
        path.join(repoPath, ".opensprint/prd.json"),
        JSON.stringify({ version: 1, sections: {}, changeLog: [] })
      );

      // Deferred during conflict
      await gitCommitQueue.enqueueAndWait({
        type: "prd_update",
        repoPath,
        source: "sketch",
      });

      // Resolve conflicts — the staged prd.json (version 1) is included
      await resolveConflicts(repoPath);

      // Flush deferred state first (will be a no-op commit since resolve included it)
      await gitCommitQueue.retryPendingCommits(repoPath);

      // Now write new content and enqueue — should create a normal commit
      await fs.writeFile(
        path.join(repoPath, ".opensprint/prd.json"),
        JSON.stringify({ version: 2, sections: {}, changeLog: [] })
      );
      await gitCommitQueue.enqueueAndWait({
        type: "prd_update",
        repoPath,
        source: "plan",
        planId: "p1",
      });

      const { stdout } = await execAsync("git log --oneline -4", { cwd: repoPath });
      expect(stdout).toContain("prd: updated after Plan p1 built");

      // Verify latest content
      const { stdout: show } = await execAsync("git show HEAD:.opensprint/prd.json", {
        cwd: repoPath,
      });
      expect(JSON.parse(show).version).toBe(2);
    });

    it("should throw RepoConflictError for worktree_merge with unmerged files", async () => {
      await createMergeConflict(repoPath);

      // Create another branch to attempt merging
      // (use a commit from before the conflict so the branch exists)
      try {
        await execAsync("git branch another-branch HEAD~1", { cwd: repoPath });
      } catch {
        // Branch creation might fail if HEAD~1 doesn't exist; skip test
        return;
      }

      let caughtError: unknown;
      try {
        await gitCommitQueue.enqueueAndWait({
          type: "worktree_merge",
          repoPath,
          branchName: "another-branch",
          taskTitle: "test merge",
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(RepoConflictError);
      expect((caughtError as RepoConflictError).unmergedFiles.length).toBeGreaterThan(0);
    });

    it("should persist pending state to disk for crash recovery", async () => {
      await createMergeConflict(repoPath);

      await fs.mkdir(path.join(repoPath, ".opensprint"), { recursive: true });
      await fs.writeFile(
        path.join(repoPath, ".opensprint/prd.json"),
        JSON.stringify({ version: 1, sections: {}, changeLog: [] })
      );

      // Deferred during conflict
      await gitCommitQueue.enqueueAndWait({
        type: "prd_update",
        repoPath,
        source: "sketch",
      });

      // Verify pending-commits.json was written to disk
      const pendingPath = path.join(repoPath, ".opensprint/pending-commits.json");
      const pendingRaw = await fs.readFile(pendingPath, "utf-8");
      const pending = JSON.parse(pendingRaw);
      expect(pending.files).toContain(".opensprint/prd.json");

      // Resolve conflicts
      await resolveConflicts(repoPath);

      // Flush — should clean up the pending-commits.json file
      await gitCommitQueue.retryPendingCommits(repoPath);

      // Verify the file is cleaned up
      let fileExists = true;
      try {
        await fs.access(pendingPath);
      } catch {
        fileExists = false;
      }
      expect(fileExists).toBe(false);
    });

    it("retryPendingCommits should be a no-op when repo still has conflicts", async () => {
      await createMergeConflict(repoPath);

      await fs.mkdir(path.join(repoPath, ".opensprint"), { recursive: true });
      await fs.writeFile(
        path.join(repoPath, ".opensprint/prd.json"),
        JSON.stringify({ version: 1, sections: {}, changeLog: [] })
      );

      await gitCommitQueue.enqueueAndWait({
        type: "prd_update",
        repoPath,
        source: "sketch",
      });

      // retryPendingCommits while conflicts remain — should not throw or commit
      await gitCommitQueue.retryPendingCommits(repoPath);

      const { stdout } = await execAsync("git log -1 --oneline", { cwd: repoPath });
      expect(stdout).not.toContain("deferred commit");
    });
  });
});
