import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import type { TaskType, TaskPriority } from "@opensprint/shared";
import { AppError } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";
import { createLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { beadsCache } from "./beads-cache.js";

const execAsync = promisify(exec);
const log = createLogger("beads");

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024; // 2MB for large list output

/**
 * Per-repo sync state: when we last synced and JSONL mtime at that moment.
 * Used for mtime-based invalidation: if JSONL mtime > jsonlMtimeAtSync, re-sync
 * before running beads commands (handles git pull, external exports, etc.).
 */
interface SyncState {
  lastSyncMs: number;
  jsonlMtime: number;
}
const syncStateMap = new Map<string, SyncState>();

/**
 * Per-repo mutex: serialize all bd CLI invocations for the same repoPath.
 * Beads 0.55+ embedded Dolt crashes with SIGSEGV when two bd processes run
 * concurrently on the same repo (beads#1935). Only one bd command at a time per repo.
 */
const execMutexMap = new Map<string, Promise<unknown>>();

/** Path to backend.pid file for file-based lock (prevents multiple backends managing same repo) */
const BACKEND_PID_FILE = ".beads/backend.pid";

/**
 * Raw shape returned by `bd list --json` / `bd show --json`.
 * Field names use snake_case to match the beads CLI output.
 */
export interface BeadsIssue {
  id: string;
  title: string;
  description?: string;
  issue_type: string;
  status: string;
  priority: number;
  assignee?: string | null;
  owner?: string | null;
  labels?: string[];
  created_at: string;
  updated_at: string;
  created_by?: string;
  dependency_count?: number;
  dependent_count?: number;
  comment_count?: number;
  [key: string]: unknown;
}

/**
 * Service for interacting with the beads CLI (`bd`).
 * All commands use --json flags for programmatic integration.
 */
export class BeadsService {
  /**
   * Ensures the repo is ready for beads commands. Syncs JSONL into the database
   * if needed. The bd CLI no longer has a daemon subsystem.
   */
  async ensureDaemon(repoPath: string): Promise<void> {
    await this.ensureSyncBeforeExec(repoPath);
  }

  /**
   * Removes backend.pid for the given repo paths so the next backend can claim
   * the repo. Called on shutdown. The bd CLI no longer has a daemon subsystem.
   */
  async stopDaemonsForRepos(repoPaths: string[]): Promise<void> {
    for (const p of repoPaths) {
      try {
        const pidPath = path.join(p, BACKEND_PID_FILE);
        if (fs.existsSync(pidPath)) {
          const content = fs.readFileSync(pidPath, "utf-8").trim();
          if (parseInt(content, 10) === process.pid) {
            fs.unlinkSync(pidPath);
          }
        }
      } catch {
        /* best effort */
      }
    }
  }

  /** Returns repo paths managed by this backend (empty; daemon subsystem removed). */
  static getManagedRepoPaths(): string[] {
    return [];
  }

  /** Reset module-level state (for tests only) */
  static resetForTesting(): void {
    syncStateMap.clear();
    execMutexMap.clear();
    beadsCache.clear();
  }

  /**
   * Run fn with exclusive access to bd for this repo. Serializes all bd CLI
   * invocations per repo to avoid beads 0.55+ Dolt SIGSEGV on concurrent access.
   */
  private async withBeadsMutex<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
    const key = this.repoKey(repoPath);
    const prev = execMutexMap.get(key) ?? Promise.resolve();
    const work = prev.then(
      () => fn(),
      () => fn()
    );
    execMutexMap.set(key, work);
    return work as Promise<T>;
  }

  /**
   * Normalize .beads/issues.jsonl so beads import accepts it.
   * Beads does not accept status "tombstone"; replace with "closed" and set closed_at/close_reason.
   * Mutates the file only if at least one issue had status tombstone.
   */
  private normalizeJsonlTombstones(repoPath: string): void {
    const jsonlPath = path.join(repoPath, ".beads/issues.jsonl");
    let content: string;
    try {
      content = fs.readFileSync(jsonlPath, "utf-8");
    } catch {
      return;
    }
    const lines = content.split("\n").filter((line) => line.trim());
    let changed = false;
    const normalized = lines.map((line) => {
      try {
        const issue = JSON.parse(line) as Record<string, unknown>;
        if (issue.status !== "tombstone") return line;
        changed = true;
        issue.status = "closed";
        if (issue.closed_at == null && issue.deleted_at != null) {
          issue.closed_at = issue.deleted_at;
        }
        if (issue.close_reason == null) {
          issue.close_reason = (issue.delete_reason as string) ?? "batch delete";
        }
        return JSON.stringify(issue);
      } catch {
        return line;
      }
    });
    if (changed) {
      fs.writeFileSync(
        jsonlPath,
        normalized.join("\n") + (content.endsWith("\n") ? "\n" : ""),
        "utf-8"
      );
      log.info("Normalized tombstone status to closed in issues.jsonl", { repoPath });
    }
  }

  /**
   * Import JSONL into the database to fix staleness (e.g. after git pull).
   * Tries `bd sync --import-only` first (beads-recommended for "Database out of sync").
   * Falls back to `bd import` with progressively more permissive orphan-handling:
   * - allow: child issues whose parent was deleted are still imported
   * - skip: skip issues whose parent doesn't exist (partial import when JSONL has bad refs)
   * Throws if all attempts fail — no silent continuation with a still-stale DB.
   */
  private async syncImport(repoPath: string): Promise<void> {
    let lastError: string | undefined;
    const jsonlPath = path.join(repoPath, ".beads/issues.jsonl");

    this.normalizeJsonlTombstones(repoPath);

    // 1. Try beads-recommended sync --import-only
    try {
      await execAsync(`bd sync --import-only`, {
        cwd: repoPath,
        timeout: 30_000,
        maxBuffer: MAX_BUFFER_BYTES,
      });
      return;
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      lastError = e.stderr ?? e.message ?? String(err);
      log.warn("sync --import-only failed, trying import", { repoPath, err: lastError });
    }

    // 2. Fallback: import with --orphan-handling allow (children whose parent was deleted)
    for (const orphanHandling of ["allow", "skip"] as const) {
      try {
        await execAsync(`bd import -i "${jsonlPath}" --orphan-handling ${orphanHandling}`, {
          cwd: repoPath,
          timeout: 30_000,
          maxBuffer: MAX_BUFFER_BYTES,
        });
        if (orphanHandling === "skip") {
          log.warn(
            "Recovery: import succeeded with --orphan-handling skip; some issues may be missing",
            {
              repoPath,
            }
          );
        }
        return;
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        lastError = e.stderr ?? e.message ?? String(err);
        log.warn(`import --orphan-handling ${orphanHandling} failed`, { repoPath, err: lastError });
      }
    }

    const manualFix =
      " Run in the project directory: bd sync --import-only, or bd import -i .beads/issues.jsonl --orphan-handling allow (or --orphan-handling skip to skip issues with missing parents).";
    throw new AppError(
      502,
      ErrorCodes.BEADS_SYNC_FAILED,
      `Beads database sync failed. All import attempts failed.${manualFix}\nLast error: ${lastError}`,
      {
        syncError: lastError,
        importError: lastError,
      }
    );
  }

  /** Canonical key for per-repo maps so trailing slash / resolution doesn't fragment state. */
  private repoKey(repoPath: string): string {
    return path.resolve(repoPath);
  }

  /**
   * Returns the mtime of .beads/issues.jsonl in ms, or 0 if missing/unreadable.
   */
  private async getJsonlMtime(repoPath: string): Promise<number> {
    try {
      const p = path.join(repoPath, ".beads/issues.jsonl");
      const stat = await fsPromises.stat(p);
      return stat.mtimeMs;
    } catch {
      return 0;
    }
  }

  /**
   * Ensures the beads DB is in sync with JSONL before running commands.
   * Syncs when: (a) never synced for this repo, or (b) JSONL mtime > when we last synced.
   */
  private async ensureSyncBeforeExec(repoPath: string): Promise<void> {
    const key = this.repoKey(repoPath);
    const jsonlMtime = await this.getJsonlMtime(repoPath);
    const state = syncStateMap.get(key);
    const needsSync = !state || jsonlMtime > state.jsonlMtime;
    if (needsSync) {
      await this.syncImport(repoPath);
      syncStateMap.set(key, {
        lastSyncMs: Date.now(),
        jsonlMtime: jsonlMtime || (await this.getJsonlMtime(repoPath)),
      });
    }
  }

  /**
   * Clears sync state for a repo so the next beads command will re-sync.
   * Call when we've hit a stale error and want to force a fresh sync.
   */
  private invalidateSyncState(repoPath: string): void {
    syncStateMap.delete(this.repoKey(repoPath));
  }

  private isStaleDbError(stderr: string): boolean {
    return (
      stderr.includes("Database out of sync") ||
      stderr.includes("bd sync --import-only") ||
      stderr.includes("refusing to export stale database") ||
      stderr.includes("Export would lose")
    );
  }

  /**
   * Execute a bd command in the context of a project directory.
   * Ensures beads is ready, then runs the command.
   * Auto-recovers from stale-database errors by running sync import and retrying once.
   * Serialized per-repo via withBeadsMutex to avoid beads 0.55+ Dolt SIGSEGV.
   */
  private async exec(
    repoPath: string,
    command: string,
    options?: { timeout?: number }
  ): Promise<string> {
    return this.withBeadsMutex(repoPath, () => this.execImpl(repoPath, command, options));
  }

  /**
   * Internal exec implementation (no mutex). Call only from code already holding
   * the beads mutex for this repo (exec, export, syncFromJsonl).
   */
  private async execImpl(
    repoPath: string,
    command: string,
    options?: { timeout?: number }
  ): Promise<string> {
    await this.ensureDaemon(repoPath);
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
    const fullCmd = `bd ${command}`;
    try {
      const { stdout } = await execAsync(fullCmd, {
        cwd: repoPath,
        timeout,
        maxBuffer: MAX_BUFFER_BYTES,
      });
      if (/^(create|update|close|dep |sync)/.test(command)) {
        beadsCache.invalidateListAll(repoPath);
      }
      return stdout;
    } catch (error: unknown) {
      const err = error as {
        message: string;
        stderr?: string;
        stdout?: string;
        code?: number;
        killed?: boolean;
        signal?: string;
      };
      if (err.killed && err.signal === "SIGTERM") {
        throw new AppError(
          504,
          ErrorCodes.BEADS_TIMEOUT,
          `Beads command timed out after ${timeout}ms: ${fullCmd}\n${err.stderr || err.message}`,
          {
            command: fullCmd,
            timeout,
          }
        );
      }

      const stderr = err.stderr || err.stdout || err.message;
      if (this.isStaleDbError(stderr)) {
        log.warn("Stale DB detected, invalidating sync and retrying", { command: fullCmd });
        this.invalidateSyncState(repoPath);
        await this.ensureSyncBeforeExec(repoPath);
        try {
          const { stdout } = await execAsync(fullCmd, {
            cwd: repoPath,
            timeout,
            maxBuffer: MAX_BUFFER_BYTES,
          });
          return stdout;
        } catch (retryError: unknown) {
          const retryErr = retryError as { stderr?: string; stdout?: string; message: string };
          const retryStderr = retryErr.stderr || retryErr.stdout || retryErr.message;
          const manualFix =
            " To fix manually, run in the project directory: bd sync --import-only, or bd import -i .beads/issues.jsonl --orphan-handling allow (or --orphan-handling skip)";
          throw new AppError(
            502,
            ErrorCodes.BEADS_COMMAND_FAILED,
            `Beads command failed after sync retry: ${fullCmd}\n${retryStderr}${manualFix}`,
            {
              command: fullCmd,
              stderr: retryStderr,
            }
          );
        }
      }

      throw new AppError(
        502,
        ErrorCodes.BEADS_COMMAND_FAILED,
        `Beads command failed: ${fullCmd}\n${stderr}`,
        {
          command: fullCmd,
          stderr,
        }
      );
    }
  }

  /**
   * Run bd with command and args, return parsed JSON.
   * Use for commands that output JSON (--json flag).
   */
  async runBd(
    repoPath: string,
    command: string,
    args: string[] = [],
    options?: { timeout?: number }
  ): Promise<unknown> {
    const fullCmd = [command, ...args].filter(Boolean).join(" ");
    const stdout = await this.exec(repoPath, fullCmd, options);
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    try {
      const jsonStart = trimmed.indexOf("{");
      const arrStart = trimmed.indexOf("[");
      const start = jsonStart >= 0 && (arrStart < 0 || jsonStart < arrStart) ? jsonStart : arrStart;
      if (start >= 0) {
        return JSON.parse(trimmed.slice(start));
      }
      return JSON.parse(trimmed);
    } catch {
      throw new AppError(
        502,
        ErrorCodes.BEADS_PARSE_FAILED,
        `Failed to parse beads JSON output: ${trimmed.slice(0, 200)}`,
        {
          outputPreview: trimmed.slice(0, 200),
        }
      );
    }
  }

  private parseJson(stdout: string): BeadsIssue {
    try {
      return JSON.parse(stdout.trim());
    } catch {
      const jsonStart = stdout.indexOf("{");
      if (jsonStart >= 0) {
        return JSON.parse(stdout.slice(jsonStart));
      }
      throw new AppError(
        502,
        ErrorCodes.BEADS_PARSE_FAILED,
        `Failed to parse beads JSON output: ${stdout}`,
        {
          outputPreview: stdout.slice(0, 200),
        }
      );
    }
  }

  private parseJsonArray(stdout: string): BeadsIssue[] {
    try {
      const parsed = JSON.parse(stdout.trim());
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      const jsonStart = stdout.indexOf("[");
      if (jsonStart >= 0) {
        return JSON.parse(stdout.slice(jsonStart));
      }
      if (stdout.trim() === "" || stdout.trim() === "[]") {
        return [];
      }
      throw new AppError(
        502,
        ErrorCodes.BEADS_PARSE_FAILED,
        `Failed to parse beads JSON array output: ${stdout}`,
        {
          outputPreview: stdout.slice(0, 200),
        }
      );
    }
  }

  /** Initialize beads in a project repository. */
  async init(repoPath: string): Promise<void> {
    return this.withBeadsMutex(repoPath, async () => {
      try {
        await execAsync(`bd init`, {
          cwd: repoPath,
          timeout: DEFAULT_TIMEOUT_MS,
        });
      } catch (error: unknown) {
        const err = error as { stderr?: string; stdout?: string; message: string };
        const msg = err.stderr || err.stdout || err.message;
        if (msg.includes("already initialized")) return;
        throw new AppError(502, ErrorCodes.BEADS_COMMAND_FAILED, `Beads init failed: ${msg}`, {
          command: "bd init",
          stderr: msg,
        });
      }
    });
  }

  /**
   * Configure beads (e.g. auto-flush, auto-commit).
   * Used during project setup to disable auto-commit (PRD §5.9).
   */
  async configSet(repoPath: string, key: string, value: string | boolean): Promise<void> {
    const val = typeof value === "boolean" ? (value ? "true" : "false") : value;
    await this.exec(repoPath, `config set ${key} ${val}`);
  }

  /**
   * Export beads state to JSONL file (PRD §5.9).
   * Orchestrator manages persistence explicitly when auto-commit is disabled.
   *
   * Imports from the JSONL first so the database includes any issues added
   * externally (e.g. by agents in worktrees or git merges). If the normal
   * export still fails after import, falls back to --force to avoid blocking
   * the commit queue indefinitely.
   */
  async export(repoPath: string, outputPath: string): Promise<void> {
    return this.withBeadsMutex(repoPath, async () => {
      // Pre-import: ingest any issues added externally (worktrees, git merges).
      // Use sync --import-only instead of bd import: import can fail with duplicate primary key
      // (Error 1062) when DB already has the issue; sync --import-only merges correctly.
      try {
        await this.execImpl(repoPath, "sync --import-only");
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        log.warn("pre-export sync failed, trying import", { err: e.stderr ?? e.message });
        try {
          await this.execImpl(repoPath, `import -i "${outputPath}" --orphan-handling allow`);
        } catch (importErr: unknown) {
          const ie = importErr as { stderr?: string; message?: string };
          log.warn("pre-export import failed", { err: ie.stderr ?? ie.message });
        }
      }

      try {
        await this.execImpl(repoPath, `export -o ${outputPath}`);
      } catch (err: unknown) {
        log.warn("export failed, running full import before force retry", {
          err: (err as { message?: string }).message,
        });
        try {
          await this.execImpl(repoPath, "sync --import-only");
          await this.execImpl(repoPath, `export -o ${outputPath}`);
        } catch {
          log.warn("export still failed after re-import, forcing to unblock commit queue");
          await this.execImpl(repoPath, `export -o ${outputPath} --force`);
        }
      }
    });
  }

  /** Create a new issue */
  async create(
    repoPath: string,
    title: string,
    options: {
      type?: TaskType | string;
      priority?: TaskPriority | number;
      description?: string;
      parentId?: string;
    } = {}
  ): Promise<BeadsIssue> {
    let cmd = `create "${title}" --json`;
    if (options.type) cmd += ` -t ${options.type}`;
    if (options.priority !== undefined) cmd += ` -p ${options.priority}`;
    if (options.description) cmd += ` -d "${options.description.replace(/"/g, '\\"')}"`;
    if (options.parentId) cmd += ` --parent ${options.parentId}`;
    const stdout = await this.exec(repoPath, cmd);
    return this.parseJson(stdout);
  }

  private isDuplicateKeyError(err: unknown): boolean {
    const msg = getErrorMessage(err);
    const details = (err as { details?: { stderr?: string } })?.details?.stderr ?? "";
    const fullMsg = msg + details;
    return (
      fullMsg.includes("UNIQUE constraint failed") ||
      fullMsg.includes("duplicate primary key") ||
      fullMsg.includes("Error 1062")
    );
  }

  /**
   * Create an issue with retry on duplicate-key errors.
   * When fallbackToStandalone is true and all retries with parentId fail,
   * tries creating without parent and returns null if that also fails.
   */
  async createWithRetry(
    repoPath: string,
    title: string,
    options: {
      type?: TaskType | string;
      priority?: TaskPriority | number;
      description?: string;
      parentId?: string;
    } = {},
    opts?: { fallbackToStandalone?: boolean }
  ): Promise<BeadsIssue | null> {
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.create(repoPath, title, options);
      } catch (err) {
        if (!this.isDuplicateKeyError(err)) {
          throw err;
        }

        if (attempt < MAX_RETRIES) {
          log.warn("Duplicate task ID, retrying", {
            attempt: attempt + 1,
            maxRetries: MAX_RETRIES + 1,
            title,
          });
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
          continue;
        }

        if (opts?.fallbackToStandalone && options.parentId) {
          log.warn("Duplicate ID persists under parent, creating standalone task", {
            parentId: options.parentId,
            title,
          });
          try {
            return await this.create(repoPath, title, {
              ...options,
              parentId: undefined,
            });
          } catch (fallbackErr) {
            log.error("Standalone fallback also failed", { title, err: fallbackErr });
            return null;
          }
        }

        log.error("Duplicate task ID with no parent fallback", { title });
        return null;
      }
    }

    return null;
  }

  /** Update an issue */
  async update(
    repoPath: string,
    id: string,
    options: {
      status?: string;
      assignee?: string;
      description?: string;
      priority?: number;
      claim?: boolean;
    } = {}
  ): Promise<BeadsIssue> {
    let cmd = `update ${id} --json`;
    if (options.status) cmd += ` --status ${options.status}`;
    if (options.assignee !== undefined) cmd += ` --assignee "${options.assignee}"`;
    if (options.description) cmd += ` -d "${options.description.replace(/"/g, '\\"')}"`;
    if (options.priority !== undefined) cmd += ` -p ${options.priority}`;
    if (options.claim) cmd += ` --claim`;
    const stdout = await this.exec(repoPath, cmd);
    return this.parseJson(stdout);
  }

  /** Close an issue (bd close returns a JSON array of closed issues, or sometimes empty output).
   * @param force - If true, use --force to close even when blocked by open issues (e.g. manual mark done).
   */
  async close(repoPath: string, id: string, reason: string, force = false): Promise<BeadsIssue> {
    let cmd = `close ${id} --reason "${reason.replace(/"/g, '\\"')}" --json`;
    if (force) cmd += " --force";
    const stdout = await this.exec(repoPath, cmd);
    const arr = this.parseJsonArray(stdout);
    let result = arr[0];
    if (!result) {
      this.invalidateSyncState(repoPath);
      result = await this.show(repoPath, id);
    }
    // bd close succeeded (exec didn't throw), so the write was applied.
    // Verification reads may return stale data due to JSONL/DB sync lag.
    // Retry with sync state invalidation before failing.
    if ((result.status as string) !== "closed") {
      this.invalidateSyncState(repoPath);
      await new Promise((r) => setTimeout(r, 200));
      try {
        result = await this.show(repoPath, id);
      } catch {
        // If show fails, trust the close command since exec succeeded
        result = { ...result, status: "closed" } as BeadsIssue;
      }
    }
    if ((result.status as string) !== "closed") {
      // bd close succeeded but verification still shows old status — trust the write
      log.warn("Close verification stale, trusting bd close success", {
        id,
        status: result.status,
      });
      result = { ...result, status: "closed" } as BeadsIssue;
    }
    return result;
  }

  /**
   * Extract blocker IDs from an issue's dependencies (no bd show). Used by ready()
   * and by callers that already have the issue (e.g. context-assembler) to avoid redundant show.
   */
  getBlockersFromIssue(issue: BeadsIssue): string[] {
    const deps =
      (issue.dependencies as Array<{
        id?: string;
        issue_id?: string;
        depends_on_id?: string;
        type?: string;
        dependency_type?: string;
      }>) ?? [];
    return deps
      .filter((d) => (d.type ?? d.dependency_type) === "blocks")
      .map((d) => d.depends_on_id ?? d.issue_id ?? d.id ?? "")
      .filter((x): x is string => !!x);
  }

  /**
   * Get ready tasks and status map in one listAll call.
   * Use this when the caller also needs the status map (e.g. orchestrator) to avoid a second listAll.
   */
  async readyWithStatusMap(
    repoPath: string
  ): Promise<{ tasks: BeadsIssue[]; statusMap: Map<string, string> }> {
    const allIssues = await this.listAll(repoPath);
    const statusMap = new Map(allIssues.map((i) => [i.id, i.status]));

    const filtered: BeadsIssue[] = [];
    for (const issue of allIssues) {
      const status = (issue.status as string) ?? "open";
      if (status !== "open") continue;
      if ((issue.issue_type ?? issue.type) === "epic") continue;

      const blockers = this.getBlockersFromIssue(issue);
      const allBlockersClosed =
        blockers.length === 0 || blockers.every((bid) => statusMap.get(bid) === "closed");
      if (allBlockersClosed) {
        filtered.push(issue);
      }
    }

    filtered.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    return { tasks: filtered, statusMap };
  }

  /**
   * Get ready tasks (priority-sorted, all blocks deps resolved).
   * Uses listAll + in-memory filtering to avoid O(N) bd show calls (previously
   * caused 60+ second stalls with 69 tasks). bd ready returns tasks whose blockers
   * may be in_progress; we only consider a blocks dependency resolved when closed.
   */
  async ready(repoPath: string): Promise<BeadsIssue[]> {
    const { tasks } = await this.readyWithStatusMap(repoPath);
    return tasks;
  }

  /** List all issues (open + in_progress by default) */
  async list(repoPath: string): Promise<BeadsIssue[]> {
    const stdout = await this.exec(repoPath, "list --json");
    return this.parseJsonArray(stdout);
  }

  /** List all issues including closed (for kanban column computation). Uses short-TTL cache. */
  async listAll(repoPath: string): Promise<BeadsIssue[]> {
    const cached = beadsCache.getListAll<BeadsIssue[]>(repoPath);
    if (cached) return cached;
    const stdout = await this.exec(repoPath, "list --all --json --limit 0");
    const result = this.parseJsonArray(stdout);
    beadsCache.setListAll(repoPath, result);
    return result;
  }

  /**
   * List in_progress tasks that have an agent assignee (agent-N).
   * Used by orphan recovery to find tasks abandoned when an agent process died.
   */
  async listInProgressWithAgentAssignee(repoPath: string): Promise<BeadsIssue[]> {
    const all = await this.list(repoPath);
    return all.filter(
      (t) =>
        t.status === "in_progress" &&
        typeof t.assignee === "string" &&
        /^agent-\d+$/.test(t.assignee)
    );
  }

  /** Show full details of an issue (bd show returns a JSON array). Uses short-TTL cache. */
  async show(repoPath: string, id: string): Promise<BeadsIssue> {
    const cached = beadsCache.getShow<BeadsIssue>(repoPath, id);
    if (cached) return cached;
    const stdout = await this.exec(repoPath, `show ${id} --json`);
    const arr = this.parseJsonArray(stdout);
    const first = arr[0];
    if (first) {
      beadsCache.setShow(repoPath, id, first);
      return first;
    }
    throw new AppError(404, ErrorCodes.ISSUE_NOT_FOUND, `Issue ${id} not found`, { issueId: id });
  }

  /**
   * Build an id→status map from all issues. Callers that need to check
   * multiple tasks in a loop should call this once and pass it through
   * to avoid N redundant `bd list --all` invocations.
   */
  async getStatusMap(repoPath: string): Promise<Map<string, string>> {
    const allIssues = await this.listAll(repoPath);
    return new Map(allIssues.map((i) => [i.id, i.status]));
  }

  /**
   * Check whether all blocks dependencies for a task are closed.
   * Accepts an optional pre-fetched statusMap to avoid redundant listAll calls
   * when checking multiple tasks in a loop.
   */
  async areAllBlockersClosed(
    repoPath: string,
    taskId: string,
    statusMap?: Map<string, string>
  ): Promise<boolean> {
    const blockers = await this.getBlockers(repoPath, taskId);
    if (blockers.length === 0) return true;
    const map = statusMap ?? (await this.getStatusMap(repoPath));
    return blockers.every((bid) => map.get(bid) === "closed");
  }

  /** Get IDs of issues that block this one (this task depends on them) */
  async getBlockers(repoPath: string, id: string): Promise<string[]> {
    try {
      const issue = await this.show(repoPath, id);
      const deps =
        (issue.dependencies as Array<{
          id?: string;
          issue_id?: string;
          depends_on_id?: string;
          type?: string;
          dependency_type?: string;
        }>) ?? [];
      return deps
        .filter((d) => (d.type ?? d.dependency_type) === "blocks")
        .map((d) => d.depends_on_id ?? d.issue_id ?? d.id ?? "")
        .filter((x): x is string => !!x);
    } catch {
      return [];
    }
  }

  /** Derive parent ID from task ID (e.g. bd-a3f8.1 -> bd-a3f8, opensprint.dev-nl2 -> opensprint.dev) */
  getParentId(taskId: string): string | null {
    const lastDot = taskId.lastIndexOf(".");
    if (lastDot <= 0) return null;
    return taskId.slice(0, lastDot);
  }

  /** Add a dependency between issues */
  async addDependency(
    repoPath: string,
    childId: string,
    parentId: string,
    type?: string
  ): Promise<void> {
    let cmd = `dep add ${childId} ${parentId} --json`;
    if (type) cmd += ` --type ${type}`;
    await this.exec(repoPath, cmd);
  }

  /** Get the dependency tree */
  async depTree(repoPath: string, id: string): Promise<string> {
    return this.exec(repoPath, `dep tree ${id}`);
  }

  /** Delete an issue */
  async delete(repoPath: string, id: string): Promise<void> {
    await this.exec(repoPath, `delete ${id} --force --json`);
  }

  /** Add a comment to an issue */
  async comment(repoPath: string, id: string, message: string): Promise<void> {
    const escaped = message.replace(/"/g, '\\"');
    await this.exec(repoPath, `comment ${id} "${escaped}"`);
  }

  /** Add a label to an issue */
  async addLabel(repoPath: string, id: string, label: string): Promise<void> {
    await this.exec(repoPath, `update ${id} --add-label ${label}`);
  }

  /** Remove a label from an issue */
  async removeLabel(repoPath: string, id: string, label: string): Promise<void> {
    await this.exec(repoPath, `update ${id} --remove-label ${label}`);
  }

  /**
   * Get cumulative attempt count from an issue's labels (PRDv2 §9.1).
   * Use when the caller already has the issue to avoid a show() call.
   */
  getCumulativeAttemptsFromIssue(issue: BeadsIssue): number {
    const labels = (issue.labels ?? []) as string[];
    const attemptsLabel = labels.find((l) => /^attempts:\d+$/.test(l));
    if (!attemptsLabel) return 0;
    const n = parseInt(attemptsLabel.split(":")[1]!, 10);
    return Number.isNaN(n) ? 0 : n;
  }

  /**
   * Get cumulative attempt count from beads labels (PRDv2 §9.1).
   * Looks for label "attempts:N"; returns 0 if none found.
   */
  async getCumulativeAttempts(repoPath: string, id: string): Promise<number> {
    const issue = await this.show(repoPath, id);
    return this.getCumulativeAttemptsFromIssue(issue);
  }

  /**
   * Set cumulative attempt count via beads labels (PRDv2 §9.1).
   * Removes any existing attempts:X label, adds attempts:count.
   * When currentLabels is provided, skips show() to avoid an extra bd call.
   */
  async setCumulativeAttempts(
    repoPath: string,
    id: string,
    count: number,
    options?: { currentLabels?: string[] }
  ): Promise<void> {
    const labels =
      options?.currentLabels ?? (((await this.show(repoPath, id)).labels ?? []) as string[]);
    const existingAttempts = labels.find((l) => /^attempts:\d+$/.test(l));
    if (existingAttempts) {
      await this.removeLabel(repoPath, id, existingAttempts);
    }
    await this.addLabel(repoPath, id, `attempts:${count}`);
  }

  /** Check whether an issue has a specific label */
  hasLabel(issue: BeadsIssue, label: string): boolean {
    return Array.isArray(issue.labels) && issue.labels.includes(label);
  }

  /** Get file scope labels (files: prefix) from an issue */
  getFileScopeLabels(issue: BeadsIssue): { modify?: string[]; create?: string[] } | null {
    const labels = (issue.labels ?? []) as string[];
    const label = labels.find((l) => l.startsWith("files:"));
    if (!label) return null;
    try {
      return JSON.parse(label.slice("files:".length));
    } catch {
      return null;
    }
  }

  /** Store actual changed files on a completed task */
  async setActualFiles(repoPath: string, id: string, files: string[]): Promise<void> {
    const issue = await this.show(repoPath, id);
    const labels = (issue.labels ?? []) as string[];
    const existing = labels.find((l) => l.startsWith("actual_files:"));
    if (existing) {
      await this.removeLabel(repoPath, id, existing);
    }
    if (files.length > 0) {
      await this.addLabel(repoPath, id, `actual_files:${JSON.stringify(files)}`);
    }
  }

  /**
   * Force a fresh import from JSONL into the database.
   * Call after operations that modify the JSONL outside of beads (e.g. worktree merges,
   * git pulls) so the DB includes any externally-added issues before the next export.
   */
  async syncFromJsonl(repoPath: string): Promise<void> {
    return this.withBeadsMutex(repoPath, async () => {
      this.invalidateSyncState(repoPath);
      await this.syncImport(repoPath);
    });
  }

  /** Sync beads with git */
  async sync(repoPath: string): Promise<void> {
    await this.exec(repoPath, "sync");
  }
}
