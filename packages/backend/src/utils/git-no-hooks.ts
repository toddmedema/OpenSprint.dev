/**
 * Cross-platform path for disabling Git hooks (e.g. for commits/rebases from the app).
 * On Windows /dev/null does not exist; use an empty directory under temp instead.
 */

import fs from "fs";
import os from "os";
import path from "path";

const DIR_NAME = "opensprint-git-no-hooks";
let cachedPath: string | null = null;

/**
 * Returns a path to an empty directory that Git can use as core.hooksPath to skip hooks.
 * The directory is created on first use. Safe to call from any platform.
 */
export function getGitNoHooksPath(): string {
  if (cachedPath) return cachedPath;
  const dir = path.join(os.tmpdir(), DIR_NAME);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Best effort; directory may already exist
  }
  cachedPath = dir;
  return dir;
}
