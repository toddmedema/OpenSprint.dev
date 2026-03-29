import fs from "fs/promises";
import os from "os";
import path from "path";
import { ensureRepoHasInitialCommit } from "../utils/git-repo-state.js";
import { getGitNoHooksPath } from "../utils/git-no-hooks.js";
import { createLogger } from "../utils/logger.js";
import { runCommand as runCommandDefault, type CommandRunResult } from "../utils/command-runner.js";
import { BranchManager } from "./branch-manager.js";

const log = createLogger("validation-workspace");
const NPM_CI_TIMEOUT_MS = 10 * 60 * 1000;
const NPM_INCLUDE_DEV_ENV = {
  NPM_CONFIG_INCLUDE: "dev",
  npm_config_include: "dev",
  NPM_CONFIG_OMIT: "",
  npm_config_omit: "",
} as const;

export type ValidationWorkspaceKind = "baseline" | "merged_candidate";

export type NodeModulesStrategy = "symlink" | "repo_repair_then_symlink" | "npm_ci_worktree" | "none";

export interface NodeModulesResult {
  ok: boolean;
  strategy: NodeModulesStrategy;
  error?: string;
}

export interface ValidationWorkspaceHandle {
  kind: ValidationWorkspaceKind;
  worktreePath: string;
  branchName: string | null;
  cleanup(): Promise<void>;
}

interface ValidationWorkspaceServiceDeps {
  runCommand?: (
    spec: { command: string; args?: string[] },
    options: { cwd: string; timeout?: number; env?: Record<string, string> }
  ) => Promise<CommandRunResult>;
  branchManager?: BranchManager;
}

function slugifyForGitRef(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._/-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "workspace"
  );
}

export class ValidationWorkspaceService {
  private runCommand: NonNullable<ValidationWorkspaceServiceDeps["runCommand"]>;
  private branchManager: BranchManager;

  constructor(deps: ValidationWorkspaceServiceDeps = {}) {
    this.runCommand = deps.runCommand ?? runCommandDefault;
    this.branchManager = deps.branchManager ?? new BranchManager();
  }

  private async createWorkspaceBaseDir(kind: ValidationWorkspaceKind): Promise<string> {
    const baseDir = path.join(os.tmpdir(), "opensprint-validation");
    await fs.mkdir(baseDir, { recursive: true });
    return fs.mkdtemp(path.join(baseDir, `${kind}-`));
  }

  private async cleanupWorktree(
    repoPath: string,
    worktreePath: string,
    branchName: string | null
  ): Promise<void> {
    try {
      await this.runCommand(
        {
          command: "git",
          args: ["worktree", "remove", worktreePath, "--force"],
        },
        {
          cwd: repoPath,
          timeout: 30_000,
        }
      );
    } catch (err) {
      log.warn("Failed to remove validation worktree via git; falling back to fs cleanup", {
        worktreePath,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    await fs.rm(path.dirname(worktreePath), { recursive: true, force: true }).catch(() => {});
    if (branchName) {
      await this.runCommand(
        {
          command: "git",
          args: ["branch", "-D", branchName],
        },
        {
          cwd: repoPath,
          timeout: 30_000,
        }
      ).catch(() => {});
    }
  }

  private async verifyWorkspaceReady(
    repoPath: string,
    worktreePath: string,
    kind: ValidationWorkspaceKind
  ): Promise<void> {
    const packageJsonPath = path.join(worktreePath, "package.json");
    try {
      await fs.access(packageJsonPath);
    } catch {
      throw new Error(`Validation workspace package.json is missing: ${packageJsonPath}`);
    }

    const repoLockfilePath = path.join(repoPath, "package-lock.json");
    const workspaceLockfilePath = path.join(worktreePath, "package-lock.json");
    const repoHasLockfile = await fs
      .access(repoLockfilePath)
      .then(() => true)
      .catch(() => false);
    if (repoHasLockfile) {
      try {
        await fs.access(workspaceLockfilePath);
      } catch {
        throw new Error(
          `Validation workspace package-lock.json is missing: ${workspaceLockfilePath}`
        );
      }
    }

    const nodeModulesPath = path.join(worktreePath, "node_modules");
    if (!(await this.isNodeModulesUsable(nodeModulesPath))) {
      throw new Error(
        `Validation workspace node_modules is missing or unusable at ${nodeModulesPath}`
      );
    }

    try {
      await this.runCommand(
        {
          command: "git",
          args: ["rev-parse", "--verify", "HEAD"],
        },
        {
          cwd: worktreePath,
          timeout: 30_000,
        }
      );
    } catch (err) {
      throw new Error(
        `${kind} workspace git validation failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  async createBaselineWorkspace(
    repoPath: string,
    baseBranch: string
  ): Promise<ValidationWorkspaceHandle> {
    await ensureRepoHasInitialCommit(repoPath, baseBranch);
    const baseDir = await this.createWorkspaceBaseDir("baseline");
    const worktreePath = path.join(baseDir, "workspace");
    const noHooks = getGitNoHooksPath();
    await this.runCommand(
      {
        command: "git",
        args: [
          "-c",
          `core.hooksPath=${noHooks}`,
          "worktree",
          "add",
          "--detach",
          worktreePath,
          baseBranch,
        ],
      },
      {
        cwd: repoPath,
        timeout: 30_000,
      }
    );
    await this.branchManager.symlinkNodeModules(repoPath, worktreePath);
    await this.verifyWorkspaceReady(repoPath, worktreePath, "baseline");

    return {
      kind: "baseline",
      worktreePath,
      branchName: null,
      cleanup: async () => {
        await this.cleanupWorktree(repoPath, worktreePath, null);
      },
    };
  }

  async createMergeCandidateWorkspace(
    repoPath: string,
    taskId: string,
    baseBranch: string
  ): Promise<ValidationWorkspaceHandle> {
    await ensureRepoHasInitialCommit(repoPath, baseBranch);
    const baseDir = await this.createWorkspaceBaseDir("merged_candidate");
    const worktreePath = path.join(baseDir, "workspace");
    const branchName = `opensprint/validation/${slugifyForGitRef(taskId)}-${Date.now().toString(36)}`;
    const noHooks = getGitNoHooksPath();
    await this.runCommand(
      {
        command: "git",
        args: [
          "-c",
          `core.hooksPath=${noHooks}`,
          "worktree",
          "add",
          "-b",
          branchName,
          worktreePath,
          baseBranch,
        ],
      },
      {
        cwd: repoPath,
        timeout: 30_000,
      }
    );

    await this.ensureMergedCandidateNodeModules(repoPath, worktreePath);
    await this.verifyWorkspaceReady(repoPath, worktreePath, "merged_candidate");

    return {
      kind: "merged_candidate",
      worktreePath,
      branchName,
      cleanup: async () => {
        await this.cleanupWorktree(repoPath, worktreePath, branchName);
      },
    };
  }

  /**
   * Check whether node_modules at the given path is a real, non-empty directory
   * (or a symlink pointing to one). Returns true only when the path is usable.
   */
  private async isNodeModulesUsable(nodeModulesPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(nodeModulesPath);
      if (!stat.isDirectory()) return false;
      const entries = await fs.readdir(nodeModulesPath, { withFileTypes: true });
      return entries.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Ensure node_modules is present and accessible in a merged_candidate worktree.
   *
   * Strategy (ordered by cost):
   *   1. Symlink from main repo (fast path).
   *   2. If the symlink target is broken, ensure the main repo has healthy deps
   *      (ensureRepoNodeModules) and re-symlink.
   *   3. Fall back to `npm ci` inside the worktree itself.
   *   4. After every strategy, verify node_modules is usable.
   *
   * Returns a result describing the outcome so callers (and the gate runner's
   * repair loop) can decide what to do next.
   */
  async ensureMergedCandidateNodeModules(
    repoPath: string,
    worktreePath: string
  ): Promise<NodeModulesResult> {
    const nodeModulesPath = path.join(worktreePath, "node_modules");

    // --- Strategy 1: symlink from main repo ---
    await this.branchManager.symlinkNodeModules(repoPath, worktreePath);
    if (await this.isNodeModulesUsable(nodeModulesPath)) {
      return { ok: true, strategy: "symlink" };
    }

    // --- Strategy 2: repair main repo deps, then re-symlink ---
    log.info(
      "merged_candidate symlink target missing or empty; ensuring main repo deps are healthy",
      { worktreePath, repoPath }
    );
    const repoRepaired = await this.branchManager.ensureRepoNodeModules(repoPath);
    if (repoRepaired) {
      await this.branchManager.symlinkNodeModules(repoPath, worktreePath);
      if (await this.isNodeModulesUsable(nodeModulesPath)) {
        return { ok: true, strategy: "repo_repair_then_symlink" };
      }
    }

    // --- Strategy 3: npm ci in the worktree (requires package.json + lockfile) ---
    const pkgPath = path.join(worktreePath, "package.json");
    try {
      await fs.access(pkgPath);
    } catch {
      log.warn(
        "merged_candidate worktree has no package.json; cannot run npm ci fallback",
        { worktreePath }
      );
      return {
        ok: false,
        strategy: "none",
        error:
          "node_modules missing: symlink target empty and no package.json in worktree. " +
          "Ensure the host repo has a valid package-lock.json and run 'npm ci' in the repo root.",
      };
    }

    log.info(
      "merged_candidate symlink still broken after repo repair; running npm ci in worktree",
      { worktreePath }
    );
    try {
      await this.runCommand(
        { command: "npm", args: ["ci"] },
        { cwd: worktreePath, timeout: NPM_CI_TIMEOUT_MS, env: NPM_INCLUDE_DEV_ENV }
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.warn(
        "npm ci failed in merged_candidate worktree after symlink failure. " +
          "Merge quality gates will attempt auto-repair. " +
          "To fix manually, run 'npm ci' in the repo root.",
        { worktreePath, err: errMsg }
      );
      return {
        ok: false,
        strategy: "npm_ci_worktree",
        error:
          `All strategies to provide node_modules for merged_candidate failed. ` +
          `npm ci error: ${errMsg}. ` +
          `Run 'npm ci' in the repo root and ensure package-lock.json is valid.`,
      };
    }

    if (await this.isNodeModulesUsable(nodeModulesPath)) {
      return { ok: true, strategy: "npm_ci_worktree" };
    }

    return {
      ok: false,
      strategy: "npm_ci_worktree",
      error:
        "npm ci completed but node_modules is missing or empty. " +
        "Check that package-lock.json is valid and 'npm ci' succeeds in the repo root.",
    };
  }
}

export const validationWorkspaceService = new ValidationWorkspaceService();
