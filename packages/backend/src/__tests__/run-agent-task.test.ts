/**
 * Tests for WIP commit on SIGTERM behavior.
 * When the agent process is terminated (SIGTERM), commitWip should be called
 * to preserve any uncommitted work before exiting.
 */
import { describe, it, expect } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { BranchManager } from "../services/branch-manager.js";

const execAsync = promisify(exec);

describe("run-agent-task WIP commit on SIGTERM", () => {
  it("commitWip preserves uncommitted work on task branch (SIGTERM scenario)", async () => {
    const branchManager = new BranchManager();
    const repoPath = path.join(os.tmpdir(), `opensprint-sigterm-test-${Date.now()}`);
    await fs.mkdir(repoPath, { recursive: true });

    try {
      await execAsync("git init", { cwd: repoPath });
      await execAsync("git branch -M main", { cwd: repoPath });
      await execAsync('git config user.email "test@test.com"', { cwd: repoPath });
      await execAsync('git config user.name "Test"', { cwd: repoPath });
      await fs.writeFile(path.join(repoPath, "README"), "initial");
      await execAsync('git add README && git commit -m "initial"', { cwd: repoPath });
      await execAsync("git checkout -b opensprint/task-sigterm", { cwd: repoPath });

      await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
      await fs.writeFile(
        path.join(repoPath, "src/partial.ts"),
        "// partial work from terminated agent"
      );

      const committed = await branchManager.commitWip(repoPath, "task-sigterm");
      expect(committed).toBe(true);

      const { stdout: log } = await execAsync("git log -1 --oneline", { cwd: repoPath });
      expect(log).toContain("WIP: task-sigterm");

      const { stdout: content } = await execAsync("git show HEAD:src/partial.ts", {
        cwd: repoPath,
      });
      expect(content).toContain("partial work from terminated agent");
    } finally {
      await fs.rm(repoPath, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("context assembler prompt includes incremental commit guidance", async () => {
    const assemblerPath = path.join(__dirname, "../services/context-assembler.ts");
    const content = await fs.readFile(assemblerPath, "utf-8");
    expect(content).toContain("Commit after each meaningful change");
    expect(content).toContain("Do not wait until the end to commit");
  });
});
