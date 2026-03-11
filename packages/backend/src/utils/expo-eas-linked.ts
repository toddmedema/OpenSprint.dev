/**
 * EAS project linking detection for Expo projects.
 * Checks if a project is linked to EAS by inspecting app.json/app.config.js
 * for expo.extra.eas.projectId, or by running `eas project:info`.
 */

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execAsync = promisify(exec);

const APP_JSON = "app.json";
const APP_CONFIG_JS = "app.config.js";
const APP_CONFIG_TS = "app.config.ts";

function getProjectIdFromConfig(config: unknown): string | undefined {
  const expo = (config as { expo?: { extra?: { eas?: { projectId?: string } } } })?.expo;
  const projectId = expo?.extra?.eas?.projectId;
  return typeof projectId === "string" && projectId.trim().length > 0 ? projectId.trim() : undefined;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if an Expo project is linked to EAS.
 * 1. Checks app.json for expo.extra.eas.projectId
 * 2. If not found, tries `npx expo config --json` for app.config.js/ts
 * 3. If still not found, runs `npx eas-cli project:info` (success = linked)
 * Returns false on any error (EAS CLI not installed, network failure, etc.).
 */
export async function isEasProjectLinked(repoPath: string): Promise<boolean> {
  try {
    // 1. Check app.json
    const appJsonPath = path.join(repoPath, APP_JSON);
    if (await fileExists(appJsonPath)) {
      const content = await fs.readFile(appJsonPath, "utf-8");
      const parsed = JSON.parse(content) as unknown;
      const projectId = getProjectIdFromConfig(parsed);
      if (projectId) {
        return true;
      }
    }

    // 2. Try expo config for app.config.js/ts (resolves dynamic config)
    const appConfigJsPath = path.join(repoPath, APP_CONFIG_JS);
    const appConfigTsPath = path.join(repoPath, APP_CONFIG_TS);
    if (await fileExists(appConfigJsPath) || (await fileExists(appConfigTsPath))) {
      try {
        const { stdout } = await execAsync("npx expo config --json", {
          cwd: repoPath,
          timeout: 15000,
          env: { ...process.env },
        });
        const parsed = JSON.parse(stdout?.trim() ?? "{}") as unknown;
        const projectId = getProjectIdFromConfig(parsed);
        if (projectId) {
          return true;
        }
      } catch {
        // expo config failed (expo not installed, etc.) — fall through to eas project:info
      }
    }

    // 3. Run eas project:info — success (exit 0) means linked
    await execAsync("npx eas-cli project:info", {
      cwd: repoPath,
      timeout: 15000,
      env: { ...process.env },
    });
    return true;
  } catch {
    return false;
  }
}
