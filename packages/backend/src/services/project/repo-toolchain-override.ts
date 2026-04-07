import fs from "fs/promises";
import path from "path";
import type { ProjectSettings, ToolchainProfile } from "@opensprint/shared";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("repo-toolchain-override");

/** Optional repo-local merge-gate defaults for dogfooding (e.g. Open Sprint monorepo). */
const MERGE_TOOLCHAIN_FILE = ".opensprint/merge-toolchain.json";

/**
 * Deep-merge `toolchainProfile` from {@link MERGE_TOOLCHAIN_FILE} when present.
 * Stored project settings still apply for keys not set in the file.
 */
export async function mergeRepoToolchainProfileOverride(
  repoPath: string,
  settings: ProjectSettings
): Promise<ProjectSettings> {
  const abs = path.join(repoPath, MERGE_TOOLCHAIN_FILE);
  let rawText: string;
  try {
    rawText = await fs.readFile(abs, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return settings;
    log.warn("Failed to read repo toolchain override", { path: abs, err });
    return settings;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as { toolchainProfile?: unknown };
  } catch (err) {
    log.warn("Invalid JSON in repo toolchain override", { path: abs, err });
    return settings;
  }
  if (!parsed || typeof parsed !== "object") return settings;
  const fromFile = (parsed as { toolchainProfile?: ToolchainProfile }).toolchainProfile;
  if (!fromFile || typeof fromFile !== "object") return settings;

  return {
    ...settings,
    toolchainProfile: {
      ...(settings.toolchainProfile ?? {}),
      ...fromFile,
    },
  };
}
