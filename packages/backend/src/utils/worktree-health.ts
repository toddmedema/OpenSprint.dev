import fs from "fs/promises";
import path from "path";

const EXCLUDED_ROOT_DIRS = new Set([
  ".git",
  ".opensprint",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "tmp",
]);

export type WorktreePreflightFailureReason =
  | "directory_missing"
  | "git_entry_missing"
  | "package_json_missing"
  | "source_directories_missing";

export interface WorktreePreflightResult {
  usable: boolean;
  failureReason?: WorktreePreflightFailureReason;
  detail?: string;
}

export class IncompleteWorktreeError extends Error {
  constructor(
    public readonly worktreePath: string,
    public readonly detail: string
  ) {
    super(`Worktree checkout at ${worktreePath} is incomplete: ${detail}`);
    this.name = "IncompleteWorktreeError";
  }
}

/**
 * Validate a freshly created worktree has the minimum expected checkout files.
 * Throws IncompleteWorktreeError if the checkout is missing critical markers.
 *
 * Call this immediately after `git worktree add` and before any agent dispatch.
 */
export async function validateWorktreeCheckout(
  repoPath: string,
  worktreePath: string
): Promise<void> {
  try {
    await fs.access(worktreePath);
  } catch {
    throw new IncompleteWorktreeError(worktreePath, "directory does not exist");
  }

  try {
    await fs.access(path.join(worktreePath, ".git"));
  } catch {
    throw new IncompleteWorktreeError(worktreePath, ".git entry is missing");
  }

  const repoHasPackageJson = await fs
    .access(path.join(repoPath, "package.json"))
    .then(() => true)
    .catch(() => false);
  if (repoHasPackageJson) {
    try {
      await fs.access(path.join(worktreePath, "package.json"));
    } catch {
      throw new IncompleteWorktreeError(
        worktreePath,
        "package.json is present in the main repo but missing in the worktree"
      );
    }
  }

  const repoRootEntries = await fs.readdir(repoPath, { withFileTypes: true }).catch(() => null);
  if (!repoRootEntries) return;

  const repoCheckoutMarkers = repoRootEntries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !name.startsWith(".") && !EXCLUDED_ROOT_DIRS.has(name));

  if (repoCheckoutMarkers.length === 0) return;

  for (const marker of repoCheckoutMarkers) {
    try {
      await fs.access(path.join(worktreePath, marker));
      return; // at least one source directory present
    } catch {
      // keep probing
    }
  }

  throw new IncompleteWorktreeError(
    worktreePath,
    `none of the expected source directories are present (checked: ${repoCheckoutMarkers.join(", ")})`
  );
}

/**
 * Structured preflight check returning a typed result instead of throwing.
 * Use before diff capture or merge-gate runs to distinguish workspace failures
 * from agent-produced empty diffs.
 */
export async function preflightWorktreeForDiff(
  repoPath: string,
  worktreePath: string
): Promise<WorktreePreflightResult> {
  try {
    await fs.access(worktreePath);
  } catch {
    return { usable: false, failureReason: "directory_missing", detail: "worktree directory does not exist" };
  }

  try {
    await fs.access(path.join(worktreePath, ".git"));
  } catch {
    return { usable: false, failureReason: "git_entry_missing", detail: ".git entry is missing from worktree" };
  }

  const repoHasPackageJson = await fs
    .access(path.join(repoPath, "package.json"))
    .then(() => true)
    .catch(() => false);
  if (repoHasPackageJson) {
    try {
      await fs.access(path.join(worktreePath, "package.json"));
    } catch {
      return {
        usable: false,
        failureReason: "package_json_missing",
        detail: "package.json is present in the main repo but missing in the worktree",
      };
    }
  }

  const repoRootEntries = await fs.readdir(repoPath, { withFileTypes: true }).catch(() => null);
  if (!repoRootEntries) return { usable: true };

  const repoCheckoutMarkers = repoRootEntries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !name.startsWith(".") && !EXCLUDED_ROOT_DIRS.has(name));

  if (repoCheckoutMarkers.length === 0) return { usable: true };

  for (const marker of repoCheckoutMarkers) {
    try {
      await fs.access(path.join(worktreePath, marker));
      return { usable: true };
    } catch {
      // keep probing
    }
  }

  return {
    usable: false,
    failureReason: "source_directories_missing",
    detail: `none of the expected source directories are present (checked: ${repoCheckoutMarkers.join(", ")})`,
  };
}

/**
 * Best-effort check that a worktree contains a real source checkout, not just runtime metadata.
 *
 * This intentionally avoids shelling out to git so it is safe in startup/recovery paths.
 */
export async function isWorktreeCheckoutUsable(
  repoPath: string,
  worktreePath: string
): Promise<boolean> {
  try {
    await fs.access(worktreePath);
    await fs.access(path.join(worktreePath, ".git"));
  } catch {
    return false;
  }

  const repoHasPackageJson = await fs
    .access(path.join(repoPath, "package.json"))
    .then(() => true)
    .catch(() => false);
  if (repoHasPackageJson) {
    try {
      await fs.access(path.join(worktreePath, "package.json"));
    } catch {
      return false;
    }
  }

  const repoRootEntries = await fs.readdir(repoPath, { withFileTypes: true }).catch(() => null);
  if (!repoRootEntries) {
    // If we cannot inspect the repo root, keep the check conservative and avoid false negatives.
    return true;
  }

  const repoCheckoutMarkers = repoRootEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith(".") && !EXCLUDED_ROOT_DIRS.has(name));

  if (repoCheckoutMarkers.length === 0) {
    const worktreeEntries = await fs
      .readdir(worktreePath, { withFileTypes: true })
      .catch(() => null);
    if (!worktreeEntries) return true;
    return worktreeEntries.some(
      (entry) =>
        !entry.name.startsWith(".") &&
        !EXCLUDED_ROOT_DIRS.has(entry.name) &&
        (entry.isDirectory() || entry.isFile())
    );
  }

  for (const marker of repoCheckoutMarkers) {
    try {
      await fs.access(path.join(worktreePath, marker));
      return true;
    } catch {
      // Keep probing markers.
    }
  }

  return false;
}
