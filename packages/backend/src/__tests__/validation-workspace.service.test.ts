import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationWorkspaceService } from "../services/validation-workspace.service.js";
import type { BranchManager } from "../services/branch-manager.js";
import type { NodeModulesResult } from "../services/validation-workspace.service.js";

describe("ValidationWorkspaceService.ensureMergedCandidateNodeModules", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
    );
  });

  const makeTempDirs = async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "val-ws-repo-"));
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "val-ws-wt-"));
    tempDirs.push(repoPath, worktreePath);
    await fs.writeFile(
      path.join(worktreePath, "package.json"),
      JSON.stringify({ name: "test-app", version: "1.0.0" })
    );
    return { repoPath, worktreePath };
  };

  it("returns ok with strategy=symlink when symlink provides accessible node_modules", async () => {
    const { repoPath, worktreePath } = await makeTempDirs();
    const runCommand = vi.fn();
    const symlinkNodeModules = vi.fn(async (_repo: string, wt: string) => {
      const nm = path.join(wt, "node_modules");
      await fs.mkdir(nm, { recursive: true });
      await fs.writeFile(path.join(nm, ".package-lock.json"), "{}");
    });
    const ensureRepoNodeModules = vi.fn();
    const branchManager = { symlinkNodeModules, ensureRepoNodeModules } as unknown as BranchManager;
    const service = new ValidationWorkspaceService({ runCommand, branchManager });

    const result: NodeModulesResult = await service.ensureMergedCandidateNodeModules(repoPath, worktreePath);

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe("symlink");
    expect(symlinkNodeModules).toHaveBeenCalledWith(repoPath, worktreePath);
    expect(runCommand).not.toHaveBeenCalled();
    expect(ensureRepoNodeModules).not.toHaveBeenCalled();
  });

  it("tries repo repair + re-symlink when initial symlink target is broken", async () => {
    const { repoPath, worktreePath } = await makeTempDirs();
    let symlinkCalls = 0;
    const symlinkNodeModules = vi.fn(async (_repo: string, wt: string) => {
      symlinkCalls++;
      if (symlinkCalls >= 2) {
        const nm = path.join(wt, "node_modules");
        await fs.mkdir(nm, { recursive: true });
        await fs.writeFile(path.join(nm, ".package-lock.json"), "{}");
      }
    });
    const ensureRepoNodeModules = vi.fn(async () => true);
    const runCommand = vi.fn();
    const branchManager = { symlinkNodeModules, ensureRepoNodeModules } as unknown as BranchManager;
    const service = new ValidationWorkspaceService({ runCommand, branchManager });

    const result = await service.ensureMergedCandidateNodeModules(repoPath, worktreePath);

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe("repo_repair_then_symlink");
    expect(ensureRepoNodeModules).toHaveBeenCalledWith(repoPath);
    expect(symlinkNodeModules).toHaveBeenCalledTimes(2);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("falls back to npm ci in worktree when symlink and repo repair both fail", async () => {
    const { repoPath, worktreePath } = await makeTempDirs();
    const symlinkNodeModules = vi.fn(async () => undefined);
    const ensureRepoNodeModules = vi.fn(async () => false);
    const runCommand = vi.fn(async (_spec: unknown, opts: { cwd: string }) => {
      const nm = path.join(opts.cwd, "node_modules");
      await fs.mkdir(nm, { recursive: true });
      await fs.writeFile(path.join(nm, ".package-lock.json"), "{}");
      return { stdout: "", stderr: "", executable: "/usr/bin/npm", cwd: opts.cwd, exitCode: 0, signal: null };
    });
    const branchManager = { symlinkNodeModules, ensureRepoNodeModules } as unknown as BranchManager;
    const service = new ValidationWorkspaceService({ runCommand, branchManager });

    const result = await service.ensureMergedCandidateNodeModules(repoPath, worktreePath);

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe("npm_ci_worktree");
    expect(runCommand).toHaveBeenCalledWith(
      { command: "npm", args: ["ci"] },
      expect.objectContaining({ cwd: worktreePath })
    );
  });

  it("returns failure with actionable error when all strategies fail", async () => {
    const { repoPath, worktreePath } = await makeTempDirs();
    const symlinkNodeModules = vi.fn(async () => undefined);
    const ensureRepoNodeModules = vi.fn(async () => false);
    const runCommand = vi.fn(async () => {
      throw new Error("npm ci network error");
    });
    const branchManager = { symlinkNodeModules, ensureRepoNodeModules } as unknown as BranchManager;
    const service = new ValidationWorkspaceService({ runCommand, branchManager });

    const result = await service.ensureMergedCandidateNodeModules(repoPath, worktreePath);

    expect(result.ok).toBe(false);
    expect(result.strategy).toBe("npm_ci_worktree");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("npm ci error");
    expect(result.error).toContain("npm ci");
  });

  it("returns failure when worktree has no package.json and symlink fails", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "val-ws-repo-"));
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), "val-ws-wt-"));
    tempDirs.push(repoPath, worktreePath);
    const symlinkNodeModules = vi.fn(async () => undefined);
    const ensureRepoNodeModules = vi.fn(async () => false);
    const runCommand = vi.fn();
    const branchManager = { symlinkNodeModules, ensureRepoNodeModules } as unknown as BranchManager;
    const service = new ValidationWorkspaceService({ runCommand, branchManager });

    const result = await service.ensureMergedCandidateNodeModules(repoPath, worktreePath);

    expect(result.ok).toBe(false);
    expect(result.strategy).toBe("none");
    expect(result.error).toContain("no package.json");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("detects empty node_modules as unusable (symlink race)", async () => {
    const { repoPath, worktreePath } = await makeTempDirs();
    const symlinkNodeModules = vi.fn(async (_repo: string, wt: string) => {
      await fs.mkdir(path.join(wt, "node_modules"), { recursive: true });
    });
    const ensureRepoNodeModules = vi.fn(async () => false);
    const runCommand = vi.fn(async (_spec: unknown, opts: { cwd: string }) => {
      const nm = path.join(opts.cwd, "node_modules");
      await fs.mkdir(nm, { recursive: true });
      await fs.writeFile(path.join(nm, ".package-lock.json"), "{}");
      return { stdout: "", stderr: "", executable: "/usr/bin/npm", cwd: opts.cwd, exitCode: 0, signal: null };
    });
    const branchManager = { symlinkNodeModules, ensureRepoNodeModules } as unknown as BranchManager;
    const service = new ValidationWorkspaceService({ runCommand, branchManager });

    const result = await service.ensureMergedCandidateNodeModules(repoPath, worktreePath);

    // Empty node_modules from symlink is not usable, so it falls through to npm ci
    expect(result.ok).toBe(true);
    expect(result.strategy).toBe("npm_ci_worktree");
  });

  it("returns failure when npm ci succeeds but node_modules is still empty", async () => {
    const { repoPath, worktreePath } = await makeTempDirs();
    const symlinkNodeModules = vi.fn(async () => undefined);
    const ensureRepoNodeModules = vi.fn(async () => false);
    const runCommand = vi.fn(async () => {
      return { stdout: "", stderr: "", executable: "/usr/bin/npm", cwd: worktreePath, exitCode: 0, signal: null };
    });
    const branchManager = { symlinkNodeModules, ensureRepoNodeModules } as unknown as BranchManager;
    const service = new ValidationWorkspaceService({ runCommand, branchManager });

    const result = await service.ensureMergedCandidateNodeModules(repoPath, worktreePath);

    expect(result.ok).toBe(false);
    expect(result.strategy).toBe("npm_ci_worktree");
    expect(result.error).toContain("node_modules is missing or empty");
  });
});
