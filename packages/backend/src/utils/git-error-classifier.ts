import { CommandRunError } from "./command-runner.js";

export function getErrorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof CommandRunError) {
    return [err.message, err.stdout, err.stderr].filter(Boolean).join("\n");
  }
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.message === "string") parts.push(obj.message);
    if (typeof obj.stdout === "string") parts.push(obj.stdout);
    if (typeof obj.stderr === "string") parts.push(obj.stderr);
    if (typeof obj.output === "string") parts.push(obj.output);
    return parts.join("\n");
  }
  return String(err);
}

export function isNoRebaseInProgressError(err: unknown): boolean {
  return /no rebase in progress/i.test(getErrorText(err));
}

/** True when git branch -D failed because the branch does not exist. */
export function isBranchNotFoundError(err: unknown): boolean {
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    const code = obj.code ?? obj.exitCode;
    const cmd = typeof obj.cmd === "string" ? obj.cmd : String(obj.cmd ?? "");
    if (code === 1 && /branch\s+-D\s+/.test(cmd)) {
      return true;
    }
  }
  const text = getErrorText(err);
  if (
    /branch\s+.*not\s+found|not\s+found.*branch/i.test(text) ||
    (text.includes("branch") && text.includes("not found"))
  ) {
    return true;
  }
  return false;
}

export function shouldAttemptRebaseSkip(err: unknown): boolean {
  const text = getErrorText(err).toLowerCase();
  if (!text) return false;
  return (
    text.includes("could not apply") ||
    text.includes("you can instead skip this commit") ||
    text.includes("previous cherry-pick is now empty") ||
    text.includes("nothing to commit") ||
    text.includes("no changes - did you forget to use 'git add'")
  );
}
