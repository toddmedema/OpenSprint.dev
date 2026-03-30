import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPlannerWithRepoGuard } from "../services/plan/plan-repo-guard.js";

const mockShellExec = vi.fn();

vi.mock("../utils/shell-exec.js", () => ({
  shellExec: (...args: unknown[]) => mockShellExec(...args),
}));

function mockSnapshot(head: string, branch: string): void {
  mockShellExec.mockImplementation(async (command: string) => {
    if (command === "git rev-parse HEAD") return { stdout: `${head}\n` };
    if (command === "git branch --show-current") return { stdout: `${branch}\n` };
    if (command.startsWith("git diff --no-ext-diff --binary")) return { stdout: "" };
    if (command.startsWith("git diff --cached --no-ext-diff --binary")) return { stdout: "" };
    if (command.startsWith("git diff --name-only -- ")) return { stdout: "" };
    if (command.startsWith("git diff --cached --name-only -- ")) return { stdout: "" };
    if (command === "git ls-files --others --exclude-standard") return { stdout: "" };
    throw new Error(`Unexpected command: ${command}`);
  });
}

describe("runPlannerWithRepoGuard", () => {
  beforeEach(() => {
    mockShellExec.mockReset();
  });

  it("allows HEAD-only drift when working tree/index content is unchanged", async () => {
    mockSnapshot("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "main");
    let snapshotCount = 0;
    mockShellExec.mockImplementation(async (command: string) => {
      if (command === "git rev-parse HEAD") {
        snapshotCount += 1;
        const head =
          snapshotCount <= 1
            ? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        return { stdout: `${head}\n` };
      }
      if (command === "git branch --show-current") return { stdout: "main\n" };
      if (command.startsWith("git diff --no-ext-diff --binary")) return { stdout: "" };
      if (command.startsWith("git diff --cached --no-ext-diff --binary")) return { stdout: "" };
      if (command.startsWith("git diff --name-only -- ")) return { stdout: "" };
      if (command.startsWith("git diff --cached --name-only -- ")) return { stdout: "" };
      if (command === "git ls-files --others --exclude-standard") return { stdout: "" };
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(
      runPlannerWithRepoGuard({
        repoPath: "/tmp/repo",
        label: "Task generation",
        run: async () => "ok",
      })
    ).resolves.toBe("ok");
  });

  it("fails when the branch changes during planner execution", async () => {
    let snapshotCount = 0;
    mockShellExec.mockImplementation(async (command: string) => {
      if (command === "git rev-parse HEAD")
        return { stdout: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n" };
      if (command === "git branch --show-current") {
        snapshotCount += 1;
        return { stdout: snapshotCount <= 1 ? "main\n" : "feature\n" };
      }
      if (command.startsWith("git diff --no-ext-diff --binary")) return { stdout: "" };
      if (command.startsWith("git diff --cached --no-ext-diff --binary")) return { stdout: "" };
      if (command.startsWith("git diff --name-only -- ")) return { stdout: "" };
      if (command.startsWith("git diff --cached --name-only -- ")) return { stdout: "" };
      if (command === "git ls-files --others --exclude-standard") return { stdout: "" };
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(
      runPlannerWithRepoGuard({
        repoPath: "/tmp/repo",
        label: "Task generation",
        run: async () => "ok",
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("modified the repository unexpectedly"),
    });
  });
});
