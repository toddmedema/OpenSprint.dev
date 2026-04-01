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
