import { describe, it, expect, vi, afterEach } from "vitest";
import * as commandRunner from "../utils/command-runner.js";
import { runGit, gitNoHooksConfigPrefix, gitListUnmergedPaths } from "../utils/git-command.js";

describe("git-command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates to runCommand with git argv (spawn, no shell interpolation)", async () => {
    const spy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue({
      stdout: "",
      stderr: "",
      executable: "git",
      cwd: "/r",
      exitCode: 0,
      signal: null,
    });
    await runGit(["checkout", "malicious; rm -rf /"], { cwd: "/r", timeout: 5_000 });
    expect(spy).toHaveBeenCalledWith(
      { command: "git", args: ["checkout", "malicious; rm -rf /"] },
      { cwd: "/r", timeout: 5_000 }
    );
  });

  it("gitNoHooksConfigPrefix returns paired -c arguments", () => {
    expect(gitNoHooksConfigPrefix("/tmp/empty-hooks")).toEqual([
      "-c",
      "core.hooksPath=/tmp/empty-hooks",
    ]);
  });

  it("gitListUnmergedPaths parses diff-filter=U output", async () => {
    const spy = vi.spyOn(commandRunner, "runCommand").mockResolvedValue({
      stdout: "a.txt\nb.txt\n",
      stderr: "",
      executable: "git",
      cwd: "/r",
      exitCode: 0,
      signal: null,
    });
    const paths = await gitListUnmergedPaths({ cwd: "/r", timeout: 5_000 });
    expect(paths).toEqual(["a.txt", "b.txt"]);
    expect(spy).toHaveBeenCalledWith(
      { command: "git", args: ["diff", "--name-only", "--diff-filter=U"] },
      { cwd: "/r", timeout: 5_000 }
    );
  });
});
