import { runCommand, type CommandRunOptions } from "./command-runner.js";

/**
 * Run git with argument arrays (spawn, shell: false) to avoid shell metacharacter injection.
 */
export async function runGit(
  args: string[],
  options: CommandRunOptions
): Promise<{ stdout: string; stderr: string }> {
  const result = await runCommand({ command: "git", args }, options);
  return { stdout: result.stdout, stderr: result.stderr };
}

/** Paths still in conflict in the index (unmerged). Used before `git rebase --continue`. */
export async function gitListUnmergedPaths(options: CommandRunOptions): Promise<string[]> {
  const { stdout } = await runGit(["diff", "--name-only", "--diff-filter=U"], options);
  return stdout.trim().split("\n").filter(Boolean);
}

/** Place before the git subcommand (e.g. point core.hooksPath at an empty directory). */
export function gitNoHooksConfigPrefix(hooksPath: string): string[] {
  return ["-c", `core.hooksPath=${hooksPath}`];
}
