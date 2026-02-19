import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import type { TaskType, TaskPriority } from "@opensprint/shared";
import { AppError } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024; // 2MB for large list output

/**
 * All backend bd commands use --no-daemon to bypass the daemon and access
 * storage directly. This prevents the bd CLI from auto-starting a background
 * daemon on each invocation — a behaviour that previously caused thousands
 * of orphaned daemon processes and 50+ GB of leaked RAM.
 */
const BD_GLOBAL_FLAGS = "--no-daemon";

/** Repo paths where this backend has started a daemon (for shutdown cleanup) */
const managedReposForShutdown = new Set<string>();

/**
 * Repo paths where daemon has been ensured in this process.
 * Once ensured, skip daemon stop+start on subsequent exec calls (~200ms savings each).
 */
const daemonEnsuredRepos = new Set<string>();

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
   * Ensures a bd daemon is running for the repo. Runs `bd daemon stop` before
   * `bd daemon start` to prevent accumulation across backend restarts.
   * Skips if another backend instance holds the file-based lock (backend.pid).
   * Also ensures beads DB is in sync with JSONL (mtime-based invalidation).
   */
  async ensureDaemon(repoPath: string): Promise<void> {
    await this.startDaemonIfNeeded(repoPath);
    await this.ensureSyncBeforeExec(repoPath);
  }

  /**
   * Stops bd daemons for the given repo paths. Called on backend shutdown
   * to clean up daemons this process started. Also removes backend.pid so
   * the next backend can claim the repo without seeing a stale PID.
   */
  async stopDaemonsForRepos(repoPaths: string[]): Promise<void> {
    for (const p of repoPaths) {
      try {
        await execAsync("bd daemon stop", {
          cwd: p,
          timeout: 5_000,
          env: { ...process.env },
        });
      } catch {
        /* ignore — may not be running */
      }
      // Remove our backend.pid claim so next backend can take over cleanly
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

  /** Returns repo paths where this backend has started a daemon */
  static getManagedRepoPaths(): string[] {
    return Array.from(managedReposForShutdown);
  }

  /** Reset module-level state (for tests only) */
  static resetForTesting(): void {
    managedReposForShutdown.clear();
    daemonEnsuredRepos.clear();
    syncStateMap.clear();
  }

  /**
   * Starts daemon if needed. Always runs `bd daemon stop` before `bd daemon start`
   * to prevent accumulation. Skips if another backend holds backend.pid lock.
   */
  private async startDaemonIfNeeded(repoPath: string): Promise<void> {
    // Already ensured daemon for this repo in this process — skip stop+start (~200ms each)
    if (daemonEnsuredRepos.has(repoPath)) return;

    const beadsDir = path.join(repoPath, ".beads");
    const backendPidPath = path.join(repoPath, BACKEND_PID_FILE);

    // File-based lock: if another backend has backend.pid and that PID is alive, skip
    try {
      if (fs.existsSync(backendPidPath)) {
        const content = fs.readFileSync(backendPidPath, "utf-8").trim();
        const otherPid = parseInt(content, 10);
        if (!isNaN(otherPid) && otherPid !== process.pid) {
          try {
            process.kill(otherPid, 0); // signal 0 = existence check
            return; // Another backend is managing this repo
          } catch {
            /* otherPid is dead — we can take over */
          }
        }
      }
    } catch {
      /* best effort */
    }

    // Stop any potentially stale daemon before starting fresh
    try {
      await execAsync("bd daemon stop", {
        cwd: repoPath,
        timeout: 5_000,
        env: { ...process.env },
      });
    } catch {
      /* ignore — may not be running */
    }

    try {
      await execAsync("bd daemon start", {
        cwd: repoPath,
        timeout: 10_000,
        env: { ...process.env },
      });
      managedReposForShutdown.add(repoPath);
      daemonEnsuredRepos.add(repoPath);

      // Write our PID to claim we're managing this repo
      try {
        fs.mkdirSync(beadsDir, { recursive: true });
        fs.writeFileSync(backendPidPath, String(process.pid), "utf-8");
      } catch {
        /* best effort — may not be writable */
      }
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      console.warn(`[beads] daemon start failed for ${repoPath}: ${e.stderr ?? e.message}`);
    }
  }

  /**
   * Import JSONL into the database to fix staleness (e.g. after git pull).
   * Tries `bd sync --import-only` first (beads-recommended for "Database out of sync").
   * Falls back to `bd import --orphan-handling skip` when sync fails (e.g. orphan/missing-parent).
   * Throws if both fail — no silent continuation with a still-stale DB.
   */
  private async syncImport(repoPath: string): Promise<void> {
    let lastError: string | undefined;
    const jsonlPath = path.join(repoPath, ".beads/issues.jsonl");

    // 1. Try beads-recommended sync --import-only
    try {
      await execAsync(`bd ${BD_GLOBAL_FLAGS} sync --import-only`, {
        cwd: repoPath,
        timeout: 30_000,
        maxBuffer: MAX_BUFFER_BYTES,
      });
      return;
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      lastError = e.stderr ?? e.message ?? String(err);
      console.warn(
        `[beads] sync --import-only failed for ${repoPath}, trying import: ${lastError}`
      );
    }

    // 2. Fallback: import with orphan-handling skip (handles missing-parent edge cases)
    try {
      await execAsync(`bd ${BD_GLOBAL_FLAGS} import -i "${jsonlPath}" --orphan-handling skip`, {
        cwd: repoPath,
        timeout: 30_000,
        maxBuffer: MAX_BUFFER_BYTES,
      });
      return;
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      const importError = e.stderr ?? e.message ?? String(err);
      const manualFix =
        " Run in the project directory: bd sync --import-only (or bd import -i .beads/issues.jsonl --orphan-handling skip)";
      throw new AppError(
        502,
        ErrorCodes.BEADS_SYNC_FAILED,
        `Beads database sync failed. Both sync --import-only and import --orphan-handling skip failed.${manualFix}\nLast error: ${importError}`,
        {
          syncError: lastError,
          importError,
        }
      );
    }
  }

  /**
   * Returns the mtime of .beads/issues.jsonl in ms, or 0 if missing/unreadable.
   */
  private getJsonlMtime(repoPath: string): number {
    try {
      const p = path.join(repoPath, ".beads/issues.jsonl");
      const stat = fs.statSync(p);
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
    const jsonlMtime = this.getJsonlMtime(repoPath);
    const state = syncStateMap.get(repoPath);

    const needsSync = !state || jsonlMtime > state.jsonlMtime;

    if (needsSync) {
      await this.syncImport(repoPath);
      syncStateMap.set(repoPath, {
        lastSyncMs: Date.now(),
        jsonlMtime: jsonlMtime || this.getJsonlMtime(repoPath),
      });
    }
  }

  /**
   * Clears sync state for a repo so the next beads command will re-sync.
   * Call when we've hit a stale error and want to force a fresh sync.
   */
  private invalidateSyncState(repoPath: string): void {
    syncStateMap.delete(repoPath);
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
   * Ensures daemon is running (with stop-before-start to prevent accumulation)
   * then runs the command with --no-daemon for direct storage access.
   * Auto-recovers from stale-database errors by running import --orphan-handling skip and retrying once.
   */
  private async exec(
    repoPath: string,
    command: string,
    options?: { timeout?: number }
  ): Promise<string> {
    await this.ensureDaemon(repoPath);
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
    const fullCmd = `bd ${BD_GLOBAL_FLAGS} ${command}`;
    try {
      const { stdout } = await execAsync(fullCmd, {
        cwd: repoPath,
        timeout,
        maxBuffer: MAX_BUFFER_BYTES,
      });
      // Invalidate sync state after write commands so the next read triggers a fresh import.
      // This prevents stale-DB errors when list follows rapid create/update/close ops.
      if (/^(create|update|close|dep |sync)/.test(command)) {
        this.invalidateSyncState(repoPath);
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
        console.warn(`[beads] Stale DB detected for ${fullCmd}, invalidating sync and retrying`);
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
            " To fix manually, run in the project directory: bd sync --import-only (or bd import -i .beads/issues.jsonl --orphan-handling skip)";
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

  /** Initialize beads in a project repository */
  async init(repoPath: string): Promise<void> {
    try {
      await execAsync(`bd ${BD_GLOBAL_FLAGS} init`, {
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
    try {
      await execAsync(`bd ${BD_GLOBAL_FLAGS} import -i "${outputPath}" --orphan-handling skip`, {
        cwd: repoPath,
        timeout: 30_000,
        maxBuffer: MAX_BUFFER_BYTES,
      });
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      console.warn(`[beads] pre-export import failed: ${e.stderr ?? e.message}`);
    }

    try {
      await this.exec(repoPath, `export -o ${outputPath}`);
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.warn(`[beads] export failed, retrying with --force: ${e.message}`);
      await this.exec(repoPath, `export -o ${outputPath} --force`);
    }
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
      console.warn(
        `[beads] Close verification stale for ${id} (status=${result.status}); trusting bd close success`
      );
      result = { ...result, status: "closed" } as BeadsIssue;
    }
    return result;
  }

  /**
   * Get ready tasks (priority-sorted, all blocks deps resolved).
   * bd ready may return tasks whose blockers are in_progress; we only consider
   * a blocks dependency resolved when the blocker status is closed.
   *
   * Fetches the status map once and reuses it for all blocker checks to avoid
   * redundant bd list calls (previously N+1 calls for N tasks).
   */
  async ready(repoPath: string): Promise<BeadsIssue[]> {
    const stdout = await this.exec(repoPath, "ready --json -n 0");
    const rawTasks = this.parseJsonArray(stdout);
    if (rawTasks.length === 0) return [];

    const statusMap = await this.getStatusMap(repoPath);

    const filtered: BeadsIssue[] = [];
    for (const task of rawTasks) {
      const blockers = await this.getBlockers(repoPath, task.id);
      const allBlockersClosed =
        blockers.length === 0 || blockers.every((bid) => statusMap.get(bid) === "closed");
      if (allBlockersClosed) {
        filtered.push(task);
      }
    }
    return filtered;
  }

  /** List all issues (open + in_progress by default) */
  async list(repoPath: string): Promise<BeadsIssue[]> {
    const stdout = await this.exec(repoPath, "list --json");
    return this.parseJsonArray(stdout);
  }

  /** List all issues including closed (for kanban column computation) */
  async listAll(repoPath: string): Promise<BeadsIssue[]> {
    const stdout = await this.exec(repoPath, "list --all --json --limit 0");
    return this.parseJsonArray(stdout);
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

  /** Show full details of an issue (bd show returns a JSON array) */
  async show(repoPath: string, id: string): Promise<BeadsIssue> {
    const stdout = await this.exec(repoPath, `show ${id} --json`);
    const arr = this.parseJsonArray(stdout);
    const first = arr[0];
    if (first) return first;
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
   * Get cumulative attempt count from beads labels (PRDv2 §9.1).
   * Looks for label "attempts:N"; returns 0 if none found.
   */
  async getCumulativeAttempts(repoPath: string, id: string): Promise<number> {
    const issue = await this.show(repoPath, id);
    const labels = (issue.labels ?? []) as string[];
    const attemptsLabel = labels.find((l) => /^attempts:\d+$/.test(l));
    if (!attemptsLabel) return 0;
    const n = parseInt(attemptsLabel.split(":")[1]!, 10);
    return Number.isNaN(n) ? 0 : n;
  }

  /**
   * Set cumulative attempt count via beads labels (PRDv2 §9.1).
   * Removes any existing attempts:X label, adds attempts:count.
   */
  async setCumulativeAttempts(repoPath: string, id: string, count: number): Promise<void> {
    const issue = await this.show(repoPath, id);
    const labels = (issue.labels ?? []) as string[];
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

  /** Sync beads with git */
  async sync(repoPath: string): Promise<void> {
    await this.exec(repoPath, "sync");
  }
}
