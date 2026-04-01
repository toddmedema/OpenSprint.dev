import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  validateWorktreeCheckout,
  isWorktreeCheckoutUsable,
  IncompleteWorktreeError,
} from "../utils/worktree-health.js";

describe("worktree-health", () => {
  let repoDir: string;
  let worktreeDir: string;

  beforeEach(async () => {
    repoDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "wt-health-repo-")));
    worktreeDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "wt-health-wt-")));
    await fs.mkdir(path.join(repoDir, ".git"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "packages"), { recursive: true });
    await fs.writeFile(path.join(repoDir, "package.json"), "{}");
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(worktreeDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("validateWorktreeCheckout", () => {
    it("passes for a fully populated worktree", async () => {
      await fs.mkdir(path.join(worktreeDir, ".git"), { recursive: true });
      await fs.writeFile(path.join(worktreeDir, "package.json"), "{}");
      await fs.mkdir(path.join(worktreeDir, "packages"), { recursive: true });

      await expect(validateWorktreeCheckout(repoDir, worktreeDir)).resolves.toBeUndefined();
    });

    it("throws when the worktree directory does not exist", async () => {
      const ghost = path.join(os.tmpdir(), `ghost-wt-${Date.now()}`);
      await expect(validateWorktreeCheckout(repoDir, ghost)).rejects.toThrow(
        IncompleteWorktreeError
      );
      await expect(validateWorktreeCheckout(repoDir, ghost)).rejects.toThrow(
        "directory does not exist"
      );
    });

    it("throws when .git is missing from the worktree", async () => {
      await fs.writeFile(path.join(worktreeDir, "package.json"), "{}");

      await expect(validateWorktreeCheckout(repoDir, worktreeDir)).rejects.toThrow(
        ".git entry is missing"
      );
    });

    it("throws when package.json is missing but present in repo", async () => {
      await fs.mkdir(path.join(worktreeDir, ".git"), { recursive: true });

      await expect(validateWorktreeCheckout(repoDir, worktreeDir)).rejects.toThrow(
        "package.json is present in the main repo but missing in the worktree"
      );
    });

    it("passes when repo has no package.json and worktree has none", async () => {
      await fs.rm(path.join(repoDir, "package.json"));
      await fs.mkdir(path.join(worktreeDir, ".git"), { recursive: true });
      await fs.mkdir(path.join(worktreeDir, "packages"), { recursive: true });

      await expect(validateWorktreeCheckout(repoDir, worktreeDir)).resolves.toBeUndefined();
    });

    it("throws when no source directories from repo root are present in worktree", async () => {
      await fs.mkdir(path.join(worktreeDir, ".git"), { recursive: true });
      await fs.writeFile(path.join(worktreeDir, "package.json"), "{}");
      // Worktree has .git and package.json but no 'packages/' directory

      await expect(validateWorktreeCheckout(repoDir, worktreeDir)).rejects.toThrow(
        "none of the expected source directories are present"
      );
    });

    it("passes when at least one source directory matches", async () => {
      await fs.mkdir(path.join(repoDir, "src"), { recursive: true });
      await fs.mkdir(path.join(worktreeDir, ".git"), { recursive: true });
      await fs.writeFile(path.join(worktreeDir, "package.json"), "{}");
      await fs.mkdir(path.join(worktreeDir, "src"), { recursive: true });
      // 'packages' missing but 'src' is present → should pass

      await expect(validateWorktreeCheckout(repoDir, worktreeDir)).resolves.toBeUndefined();
    });

    it("ignores excluded dirs like node_modules and dist when checking markers", async () => {
      // Repo only has excluded directories as subdirs → marker list is empty → should pass
      const sparseRepo = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), "wt-health-sparse-"))
      );
      await fs.mkdir(path.join(sparseRepo, ".git"), { recursive: true });
      await fs.mkdir(path.join(sparseRepo, "node_modules"), { recursive: true });
      await fs.mkdir(path.join(sparseRepo, "dist"), { recursive: true });

      await fs.mkdir(path.join(worktreeDir, ".git"), { recursive: true });

      await expect(validateWorktreeCheckout(sparseRepo, worktreeDir)).resolves.toBeUndefined();
      await fs.rm(sparseRepo, { recursive: true, force: true }).catch(() => {});
    });
  });

  describe("isWorktreeCheckoutUsable", () => {
    it("returns true for a fully populated worktree", async () => {
      await fs.mkdir(path.join(worktreeDir, ".git"), { recursive: true });
      await fs.writeFile(path.join(worktreeDir, "package.json"), "{}");
      await fs.mkdir(path.join(worktreeDir, "packages"), { recursive: true });

      expect(await isWorktreeCheckoutUsable(repoDir, worktreeDir)).toBe(true);
    });

    it("returns false when .git is missing", async () => {
      expect(await isWorktreeCheckoutUsable(repoDir, worktreeDir)).toBe(false);
    });

    it("returns false when package.json missing in worktree but present in repo", async () => {
      await fs.mkdir(path.join(worktreeDir, ".git"), { recursive: true });

      expect(await isWorktreeCheckoutUsable(repoDir, worktreeDir)).toBe(false);
    });
  });
});
