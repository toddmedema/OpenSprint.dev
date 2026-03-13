/**
 * Expo app configuration detection and auto-configuration for first deploy.
 * When Expo is installed but not configured (or after auto-install), configures
 * app.json using project context (name, slug, version from package.json).
 */

import fs from "fs/promises";
import path from "path";

const APP_JSON = "app.json";
const APP_CONFIG_JS = "app.config.js";
const APP_CONFIG_TS = "app.config.ts";

/** Slugify a string for Expo slug (URL-friendly, lowercase, hyphens) */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "app"
  );
}

export interface ExpoConfigStatus {
  configured: boolean;
  /** Path to config file if found (app.json, app.config.js, or app.config.ts) */
  configPath?: string;
  /** Reason when not configured */
  reason?: string;
}

/**
 * Detect if Expo app config exists and is sufficiently configured.
 * "Configured" means: has expo.name and expo.slug (or equivalent) set to non-default values.
 * Default create-expo-app values like "my-app" / "my-app" are considered unconfigured
 * when we have a project name to use.
 */
export async function getExpoConfigStatus(repoPath: string): Promise<ExpoConfigStatus> {
  const appJsonPath = path.join(repoPath, APP_JSON);
  const appConfigJsPath = path.join(repoPath, APP_CONFIG_JS);
  const appConfigTsPath = path.join(repoPath, APP_CONFIG_TS);

  let configPath: string | undefined;
  let expoConfig: { name?: string; slug?: string; [k: string]: unknown } | undefined;

  if (await fileExists(appJsonPath)) {
    configPath = appJsonPath;
    try {
      const content = await fs.readFile(appJsonPath, "utf-8");
      const parsed = JSON.parse(content) as { expo?: { name?: string; slug?: string } };
      expoConfig = parsed.expo ?? parsed;
    } catch {
      return { configured: false, reason: "app.json exists but is invalid JSON" };
    }
  } else if (await fileExists(appConfigJsPath)) {
    // app.config.js is dynamic - we cannot safely parse it. Treat as configured if it exists.
    return {
      configured: true,
      configPath: appConfigJsPath,
    };
  } else if (await fileExists(appConfigTsPath)) {
    return {
      configured: true,
      configPath: appConfigTsPath,
    };
  } else {
    return { configured: false, reason: "No app.json, app.config.js, or app.config.ts found" };
  }

  if (!expoConfig) {
    return { configured: false, configPath, reason: "No expo block in app.json" };
  }

  const name = expoConfig.name;
  const slug = expoConfig.slug;

  // Consider configured if both name and slug are set and non-empty
  if (name && typeof name === "string" && slug && typeof slug === "string") {
    return { configured: true, configPath };
  }

  return {
    configured: false,
    configPath,
    reason:
      !name && !slug
        ? "Missing expo.name and expo.slug"
        : !name
          ? "Missing expo.name"
          : "Missing expo.slug",
  };
}

/**
 * Ensure Expo app config is present and populated with project context.
 * Creates app.json if missing; updates name/slug/version if empty or default.
 * @param repoPath — Project root
 * @param projectName — Open Sprint project name (used as app name and slug base)
 * @param emit — Optional callback for status messages
 */
export async function ensureExpoConfig(
  repoPath: string,
  projectName: string,
  emit?: (chunk: string) => void
): Promise<{ ok: true } | { ok: false; error: string }> {
  const status = await getExpoConfigStatus(repoPath);

  // app.config.js/ts: we don't modify dynamic configs
  if (
    status.configPath &&
    (status.configPath.endsWith(".js") || status.configPath.endsWith(".ts"))
  ) {
    return { ok: true };
  }

  const appJsonPath = path.join(repoPath, APP_JSON);
  const pkgPath = path.join(repoPath, "package.json");

  let pkgVersion = "1.0.0";
  try {
    const pkgContent = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgContent) as { version?: string };
    if (pkg.version && typeof pkg.version === "string") {
      pkgVersion = pkg.version;
    }
  } catch {
    // Use default
  }

  const appName = projectName.trim() || "App";
  const appSlug = slugify(projectName) || "app";

  let existing: Record<string, unknown> = {};
  if (await fileExists(appJsonPath)) {
    try {
      const content = await fs.readFile(appJsonPath, "utf-8");
      existing = JSON.parse(content) as Record<string, unknown>;
    } catch (err) {
      return {
        ok: false,
        error: `app.json exists but could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const expoBlock = (existing.expo as Record<string, unknown>) ?? {};
  const mergedExpo = {
    ...expoBlock,
    name: (expoBlock.name as string) || appName,
    slug: (expoBlock.slug as string) || appSlug,
    version: (expoBlock.version as string) || pkgVersion,
  };

  const needsWrite =
    (expoBlock.name as string) !== mergedExpo.name ||
    (expoBlock.slug as string) !== mergedExpo.slug ||
    (expoBlock.version as string) !== mergedExpo.version;

  if (needsWrite || !(await fileExists(appJsonPath))) {
    emit?.("Configuring Expo app (name, slug, version)...\n");
    const output = {
      ...existing,
      expo: mergedExpo,
    };
    await fs.writeFile(appJsonPath, JSON.stringify(output, null, 2), "utf-8");
  }

  return { ok: true };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
