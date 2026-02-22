/**
 * Serialized git commit queue (Refinery-like, PRD §5.9).
 * Async FIFO queue with single worker for all main-branch git operations.
 * Prevents .git/index.lock contention when multiple agents/processes trigger
 * commits (beads export, PRD update, worktree merge).
 *
 * Conflict-aware: when the repo has unmerged files, beads/PRD exports are
 * written and staged but the commit is deferred until the repo is clean.
 */

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { OPENSPRINT_PATHS } from "@opensprint/shared";
import { BeadsService } from "./beads.service.js";
import { BranchManager } from "./branch-manager.js";
import { writeJsonAtomic } from "../utils/file-utils.js";
import { createLogger } from "../utils/logger.js";

const execAsync = promisify(exec);
const log = createLogger("git-commit-queue");

/** Thrown when a worktree_merge job cannot proceed due to existing unmerged files. */
export class RepoConflictError extends Error {
  constructor(public readonly unmergedFiles: string[]) {
    super(
      `Cannot proceed: repo has ${unmergedFiles.length} unmerged file(s): ${unmergedFiles.join(", ")}`
    );
    this.name = "RepoConflictError";
  }
}

/** Job types for main-branch git operations.
 * Commit message patterns per PRD §5.9:
 * - beads: <summary of changes>
 * - prd: updated after Plan <plan-id> built | prd: Sketch session update
 * - merge: opensprint/<task-id> — <task title>
 */
export type GitCommitJobType = "beads_export" | "prd_update" | "worktree_merge";

export interface BeadsExportJob {
  type: "beads_export";
  repoPath: string;
  summary: string;
}

export interface PrdUpdateJob {
  type: "prd_update";
  repoPath: string;
  /** "plan" | "sketch" | "eval" | "execute" | "deliver" — for commit message */
  source: "plan" | "sketch" | "eval" | "execute" | "deliver";
  planId?: string;
}

export interface WorktreeMergeJob {
  type: "worktree_merge";
  repoPath: string;
  branchName: string;
  taskTitle: string;
  /** When present, merge + beads close + export in a single commit (no separate beads_export) */
  beadsClose?: { taskId: string; reason: string };
}

export type GitCommitJob = BeadsExportJob | PrdUpdateJob | WorktreeMergeJob;

export interface GitCommitQueueService {
  enqueue(job: GitCommitJob): Promise<void>;
  /** Enqueue and wait for this job to complete. Use when caller must wait (e.g. before cleanup). */
  enqueueAndWait(job: GitCommitJob): Promise<void>;
  /** Wait for all queued jobs to complete (for tests). */
  drain(): Promise<void>;
  /** Flush any deferred commits after conflict resolution. Safe to call at any time. */
  retryPendingCommits(repoPath: string): Promise<void>;
}

interface QueuedItem {
  job: GitCommitJob;
  resolve?: () => void;
  reject?: (err: Error) => void;
}

class GitCommitQueueImpl implements GitCommitQueueService {
  private queue: QueuedItem[] = [];
  private processing = false;
  private beads = new BeadsService();
  private branchManager = new BranchManager();
  private drainResolvers: Array<() => void> = [];

  /**
   * Files staged but not yet committed, keyed by repoPath.
   * Values are deduplicated file paths (e.g. ".beads/issues.jsonl").
   */
  private pendingFiles = new Map<string, Set<string>>();

  // ─── Pre-flight checks ───

  private async hasUnmergedFiles(repoPath: string): Promise<string[]> {
    try {
      const { stdout } = await execAsync("git diff --name-only --diff-filter=U", {
        cwd: repoPath,
        timeout: 10_000,
      });
      return stdout.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  // ─── Deferred commit tracking (persisted to disk for crash safety) ───

  private async trackPendingFile(repoPath: string, filePath: string): Promise<void> {
    let files = this.pendingFiles.get(repoPath);
    if (!files) {
      files = new Set();
      this.pendingFiles.set(repoPath, files);
    }
    files.add(filePath);
    await this.persistPendingFiles(repoPath);
  }

  private async persistPendingFiles(repoPath: string): Promise<void> {
    const files = this.pendingFiles.get(repoPath);
    const pendingPath = path.join(repoPath, OPENSPRINT_PATHS.pendingCommits);
    if (!files || files.size === 0) {
      await fs.unlink(pendingPath).catch(() => {});
      return;
    }
    await fs.mkdir(path.dirname(pendingPath), { recursive: true });
    await writeJsonAtomic(pendingPath, { files: [...files] });
  }

  private async loadPendingFiles(repoPath: string): Promise<void> {
    const pendingPath = path.join(repoPath, OPENSPRINT_PATHS.pendingCommits);
    try {
      const data = JSON.parse(await fs.readFile(pendingPath, "utf-8"));
      if (data.files?.length) {
        const existing = this.pendingFiles.get(repoPath) ?? new Set<string>();
        for (const f of data.files) existing.add(f);
        this.pendingFiles.set(repoPath, existing);
      }
    } catch {
      /* no file = no pending */
    }
  }

  /**
   * Stage files and commit. Returns true if a commit was created, false if
   * there was nothing to commit (file unchanged since last commit).
   * Throws on real git errors.
   */
  private async addAndCommit(repoPath: string, files: string[], message: string): Promise<boolean> {
    const addCmd = files.map((f) => `git add ${f}`).join(" && ");
    const escaped = message.replace(/"/g, '\\"');
    try {
      await execAsync(`${addCmd} && git commit -m "${escaped}"`, {
        cwd: repoPath,
        timeout: 30_000,
      });
      return true;
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string };
      const output = (e.stdout || "") + (e.stderr || "");
      if (output.includes("nothing to commit") || output.includes("nothing added to commit")) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Commit any previously deferred files. Called when the repo is clean
   * (no unmerged files) before executing the next job.
   */
  private async flushPendingCommits(repoPath: string): Promise<void> {
    await this.loadPendingFiles(repoPath);

    const files = this.pendingFiles.get(repoPath);
    if (!files || files.size === 0) return;

    const unmerged = await this.hasUnmergedFiles(repoPath);
    if (unmerged.length > 0) {
      log.warn("Cannot flush pending commits — unmerged files remain", {
        unmergedCount: unmerged.length,
      });
      return;
    }

    const fileList = [...files];
    const msg = `deferred commit: ${fileList.join(", ")}`;

    try {
      const committed = await this.addAndCommit(repoPath, fileList, msg);
      if (committed) {
        log.info("Flushed deferred files", { count: fileList.length, files: fileList });
      } else {
        log.info("Deferred files already committed (conflict resolution included them)");
      }
      this.pendingFiles.delete(repoPath);
      await this.persistPendingFiles(repoPath);
    } catch (err) {
      log.warn("Flush of deferred commits failed", { err });
    }
  }

  // ─── Job execution ───

  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      for (const resolve of this.drainResolvers) resolve();
      this.drainResolvers = [];
      return;
    }

    const item = this.queue.shift()!;
    const job = item.job;
    const maxRetries = 2;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const unmerged = await this.hasUnmergedFiles(job.repoPath);

        if (unmerged.length > 0) {
          await this.executeDeferredJob(job, unmerged);
        } else {
          await this.flushPendingCommits(job.repoPath);
          await this.executeJob(job);
        }

        item.resolve?.();
        break;
      } catch (err) {
        log.warn("Job failed", { attempt: attempt + 1, maxRetries, err });
        if (attempt === maxRetries - 1) {
          // Reject so caller (performMergeAndDone) can re-open task and retry; never resolve on failure
          item.reject?.(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }

    setImmediate(() => this.processNext());
  }

  /**
   * Execute a job normally (repo has no conflicts).
   */
  private async executeJob(job: GitCommitJob): Promise<void> {
    const { repoPath } = job;

    switch (job.type) {
      case "beads_export": {
        await this.beads.export(repoPath, ".beads/issues.jsonl");
        await this.addAndCommit(repoPath, [".beads/issues.jsonl"], `beads: ${job.summary}`);
        break;
      }
      case "prd_update": {
        const msg =
          job.source === "sketch"
            ? "prd: Sketch session update"
            : job.source === "eval"
              ? "prd: Evaluate feedback"
              : job.planId
                ? `prd: updated after Plan ${job.planId} built`
                : "prd: updated";
        await this.addAndCommit(repoPath, [".opensprint/prd.json"], msg);
        break;
      }
      case "worktree_merge": {
        await this.branchManager.ensureOnMain(repoPath);
        if (job.beadsClose) {
          await this.branchManager.mergeToMainNoCommit(repoPath, job.branchName);
          await this.beads.syncFromJsonl(repoPath);
          await this.beads.close(repoPath, job.beadsClose.taskId, job.beadsClose.reason);
          // Commit the JSONL that close() wrote. Do NOT call beads.export() here — export
          // overwrites the file from the beads Dolt DB, which does not yet contain the close
          // (close() writes via jsonlStore only), so the task would appear open again and get
          // re-picked repeatedly.
          const msg = `merge: ${job.branchName} — ${job.taskTitle} (closes ${job.beadsClose.taskId})`;
          await this.addAndCommit(repoPath, [".beads/issues.jsonl"], msg);
        } else {
          const msg = `merge: ${job.branchName} — ${job.taskTitle}`;
          await this.branchManager.mergeToMain(repoPath, job.branchName, msg);
          await this.beads.syncFromJsonl(repoPath);
        }
        break;
      }
    }
  }

  /**
   * Handle a job when the repo has unmerged files.
   * beads/PRD: write + stage the file but skip commit (deferred).
   * worktree_merge: cannot proceed — throw RepoConflictError.
   */
  private async executeDeferredJob(job: GitCommitJob, unmerged: string[]): Promise<void> {
    const { repoPath } = job;

    switch (job.type) {
      case "beads_export": {
        await this.beads.export(repoPath, ".beads/issues.jsonl");
        await execAsync("git add .beads/issues.jsonl", {
          cwd: repoPath,
          timeout: 10_000,
        });
        await this.trackPendingFile(repoPath, ".beads/issues.jsonl");
        log.warn("Deferred beads commit; staged .beads/issues.jsonl", {
          unmergedCount: unmerged.length,
        });
        break;
      }
      case "prd_update": {
        await execAsync("git add .opensprint/prd.json", {
          cwd: repoPath,
          timeout: 10_000,
        });
        await this.trackPendingFile(repoPath, ".opensprint/prd.json");
        log.warn("Deferred PRD commit; staged .opensprint/prd.json", {
          unmergedCount: unmerged.length,
        });
        break;
      }
      case "worktree_merge": {
        throw new RepoConflictError(unmerged);
      }
    }
  }

  // ─── Public API ───

  async enqueue(job: GitCommitJob): Promise<void> {
    this.queue.push({ job });
    if (!this.processing) {
      this.processing = true;
      setImmediate(() => this.processNext());
    }
  }

  async enqueueAndWait(job: GitCommitJob): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      if (!this.processing) {
        this.processing = true;
        setImmediate(() => this.processNext());
      }
    });
  }

  async drain(): Promise<void> {
    if (this.queue.length === 0 && !this.processing) return;
    return new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  async retryPendingCommits(repoPath: string): Promise<void> {
    await this.flushPendingCommits(repoPath);
  }
}

export const gitCommitQueue: GitCommitQueueService = new GitCommitQueueImpl();
