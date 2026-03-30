/**
 * Global settings store at ~/.opensprint/global-settings.json.
 * Schema (see shared `GlobalSettings`):
 * - apiKeys?, useCustomCli?, databaseUrl?, expoToken?
 * - showNotificationDotInMenuBar?, showRunningAgentCountInMenuBar?, preferredEditor?
 * - simpleComplexityAgent?, complexComplexityAgent? — same shape as project agent config
 *   (`type`, `model`, `cliCommand`, optional `baseUrl` for lmstudio/ollama). Invalid objects on disk are ignored.
 * Uses same ApiKeyEntry structure for apiKeys. Atomic writes via writeJsonAtomic.
 * databaseUrl is stored only in this JSON file; never in the database.
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import type {
  AgentConfig,
  ApiKeysUpdate,
  GlobalSettings,
  PreferredEditor,
} from "@opensprint/shared";
import {
  sanitizeApiKeys,
  mergeApiKeysWithCurrent,
  validateDatabaseUrl,
  parsePreferredEditor,
} from "@opensprint/shared";
import { writeJsonAtomic } from "../utils/file-utils.js";
import { agentConfigSchema } from "../schemas/agent-config.js";

let globalSettingsPathForTesting: string | null = null;

/**
 * Default database URL (SQLite under ~/.opensprint/data/opensprint.sqlite).
 * Node only; shared package is browser-safe and does not implement this.
 */
export function getDefaultDatabaseUrl(): string {
  return path.join(os.homedir(), ".opensprint", "data", "opensprint.sqlite");
}

function getGlobalSettingsPath(): string {
  if (globalSettingsPathForTesting) return globalSettingsPathForTesting;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
  return path.join(home, ".opensprint", "global-settings.json");
}

export function setGlobalSettingsPathForTesting(testPath: string | null): void {
  globalSettingsPathForTesting = testPath;
}

/** Default empty settings (preferredEditor defaults to "auto" per spec) */
const DEFAULT: GlobalSettings = { preferredEditor: "auto" };

function parseAgentConfigFromFile(raw: unknown): AgentConfig | undefined {
  const r = agentConfigSchema.safeParse(raw);
  return r.success ? (r.data as AgentConfig) : undefined;
}

function parseDatabaseUrl(raw: unknown): string | undefined {
  if (raw == null || typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    return validateDatabaseUrl(raw);
  } catch {
    return undefined;
  }
}

async function load(): Promise<GlobalSettings> {
  const file = getGlobalSettingsPath();
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const apiKeys = sanitizeApiKeys(obj.apiKeys);
      const useCustomCli =
        obj.useCustomCli === true || obj.useCustomCli === false ? obj.useCustomCli : undefined;
      const databaseUrl = parseDatabaseUrl(obj.databaseUrl);
      const expoToken =
        obj.expoToken != null && typeof obj.expoToken === "string" && obj.expoToken.trim()
          ? obj.expoToken.trim()
          : undefined;
      const showNotificationDotInMenuBar =
        obj.showNotificationDotInMenuBar === false
          ? false
          : obj.showNotificationDotInMenuBar === true
            ? true
            : undefined;
      const showRunningAgentCountInMenuBar =
        obj.showRunningAgentCountInMenuBar === false
          ? false
          : obj.showRunningAgentCountInMenuBar === true
            ? true
            : undefined;
      const simpleComplexityAgent = parseAgentConfigFromFile(obj.simpleComplexityAgent);
      const complexComplexityAgent = parseAgentConfigFromFile(obj.complexComplexityAgent);
      const preferredEditor = parsePreferredEditor(obj.preferredEditor) ?? "auto";
      return {
        ...(apiKeys && { apiKeys }),
        ...(useCustomCli !== undefined && { useCustomCli }),
        ...(databaseUrl && { databaseUrl }),
        ...(expoToken && { expoToken }),
        ...(showNotificationDotInMenuBar !== undefined && { showNotificationDotInMenuBar }),
        ...(showRunningAgentCountInMenuBar !== undefined && { showRunningAgentCountInMenuBar }),
        ...(simpleComplexityAgent && { simpleComplexityAgent }),
        ...(complexComplexityAgent && { complexComplexityAgent }),
        preferredEditor,
      };
    }
  } catch {
    // File missing or corrupt
  }
  return { ...DEFAULT };
}

async function save(settings: GlobalSettings): Promise<void> {
  const file = getGlobalSettingsPath();
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  await writeJsonAtomic(file, settings);
}

/**
 * Get global settings. Returns empty object if file missing or corrupt.
 */
export async function getGlobalSettings(): Promise<GlobalSettings> {
  return load();
}

/**
 * Get the effective database URL. Precedence: DATABASE_URL env (12-factor), then
 * databaseUrl from global settings, then default SQLite path (~/.opensprint/data/opensprint.sqlite).
 * Never stored in the database; only in ~/.opensprint/global-settings.json or env.
 */
export async function getDatabaseUrl(): Promise<string> {
  return (await getEffectiveDatabaseConfig()).databaseUrl;
}

export type DatabaseUrlSource = "env" | "global-settings" | "default";

export async function getEffectiveDatabaseConfig(): Promise<{
  databaseUrl: string;
  source: DatabaseUrlSource;
}> {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv != null && fromEnv.trim() !== "") {
    try {
      return {
        databaseUrl: validateDatabaseUrl(fromEnv.trim()),
        source: "env",
      };
    } catch {
      // Invalid DATABASE_URL ignored; fall through to file/default
    }
  }
  const settings = await getGlobalSettings();
  if (settings.databaseUrl) {
    return {
      databaseUrl: settings.databaseUrl,
      source: "global-settings",
    };
  }
  return {
    databaseUrl: getDefaultDatabaseUrl(),
    source: "default",
  };
}

/**
 * Set global settings (replace entire file).
 */
export async function setGlobalSettings(settings: GlobalSettings): Promise<void> {
  const sanitized: GlobalSettings = {};
  if (settings.apiKeys) {
    const sanitizedKeys = sanitizeApiKeys(settings.apiKeys);
    if (sanitizedKeys) sanitized.apiKeys = sanitizedKeys;
  }
  if (settings.useCustomCli !== undefined) {
    sanitized.useCustomCli = settings.useCustomCli;
  }
  if (settings.databaseUrl !== undefined) {
    sanitized.databaseUrl = validateDatabaseUrl(settings.databaseUrl);
  }
  if (settings.expoToken !== undefined) {
    sanitized.expoToken = settings.expoToken.trim() || undefined;
  }
  if (settings.showNotificationDotInMenuBar !== undefined) {
    sanitized.showNotificationDotInMenuBar = settings.showNotificationDotInMenuBar;
  }
  if (settings.showRunningAgentCountInMenuBar !== undefined) {
    sanitized.showRunningAgentCountInMenuBar = settings.showRunningAgentCountInMenuBar;
  }
  if (settings.simpleComplexityAgent !== undefined) {
    const p = agentConfigSchema.safeParse(settings.simpleComplexityAgent);
    if (p.success) sanitized.simpleComplexityAgent = p.data as AgentConfig;
  }
  if (settings.complexComplexityAgent !== undefined) {
    const p = agentConfigSchema.safeParse(settings.complexComplexityAgent);
    if (p.success) sanitized.complexComplexityAgent = p.data as AgentConfig;
  }
  if (settings.preferredEditor !== undefined) {
    const p = parsePreferredEditor(settings.preferredEditor);
    if (p) sanitized.preferredEditor = p;
  }
  await save(sanitized);
}

/** Partial merge input; `null` for agent fields clears the stored global default. */
export type GlobalSettingsPartialUpdate = Partial<
  Omit<
    GlobalSettings,
    "apiKeys" | "simpleComplexityAgent" | "complexComplexityAgent" | "preferredEditor"
  >
> & {
  apiKeys?: ApiKeysUpdate;
  simpleComplexityAgent?: AgentConfig | null;
  complexComplexityAgent?: AgentConfig | null;
  preferredEditor?: PreferredEditor | null;
};

/**
 * Update global settings with partial merge. Merges into existing settings.
 */
export async function updateGlobalSettings(
  updates: GlobalSettingsPartialUpdate
): Promise<GlobalSettings> {
  const current = await load();
  const merged: GlobalSettings = { ...current };

  if (updates.apiKeys !== undefined) {
    const mergedKeys = mergeApiKeysWithCurrent(updates.apiKeys, current.apiKeys);
    const sanitized = sanitizeApiKeys(mergedKeys);
    merged.apiKeys = sanitized ?? undefined;
  }
  if (updates.useCustomCli !== undefined) {
    merged.useCustomCli = updates.useCustomCli;
  }
  if (updates.databaseUrl !== undefined) {
    merged.databaseUrl = validateDatabaseUrl(updates.databaseUrl);
  }
  if (updates.expoToken !== undefined) {
    merged.expoToken = updates.expoToken.trim() || undefined;
  }
  if (updates.showNotificationDotInMenuBar !== undefined) {
    merged.showNotificationDotInMenuBar = updates.showNotificationDotInMenuBar;
  }
  if (updates.showRunningAgentCountInMenuBar !== undefined) {
    merged.showRunningAgentCountInMenuBar = updates.showRunningAgentCountInMenuBar;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "simpleComplexityAgent")) {
    if (updates.simpleComplexityAgent === null) {
      delete merged.simpleComplexityAgent;
    } else if (updates.simpleComplexityAgent !== undefined) {
      merged.simpleComplexityAgent = updates.simpleComplexityAgent;
    }
  }
  if (Object.prototype.hasOwnProperty.call(updates, "complexComplexityAgent")) {
    if (updates.complexComplexityAgent === null) {
      delete merged.complexComplexityAgent;
    } else if (updates.complexComplexityAgent !== undefined) {
      merged.complexComplexityAgent = updates.complexComplexityAgent;
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, "preferredEditor")) {
    if (updates.preferredEditor === null) {
      delete merged.preferredEditor;
    } else if (updates.preferredEditor !== undefined) {
      merged.preferredEditor = updates.preferredEditor;
    }
  }

  await save(merged);
  return merged;
}

/** Serialization lock for atomic updates */
let atomicLock: Promise<void> = Promise.resolve();

/**
 * Ensures ~/.opensprint exists and global-settings.json has default databaseUrl if missing.
 * Used by setup.sh. Idempotent; safe to run multiple times.
 */
export async function ensureDefaultDatabaseUrl(): Promise<void> {
  const current = await load();
  if (!current.databaseUrl) {
    await updateGlobalSettings({ databaseUrl: getDefaultDatabaseUrl() });
  }
}

/**
 * Atomically update global settings via read-modify-write with serialization.
 * Prevents concurrent updates from clobbering each other (same pattern as updateSettingsInStore).
 */
export async function atomicUpdateGlobalSettings(
  updater: (settings: GlobalSettings) => GlobalSettings
): Promise<void> {
  const prev = atomicLock;
  let resolve: () => void;
  atomicLock = prev.then(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  await prev;
  try {
    const current = await load();
    const updated = updater(current);
    await save(updated);
  } finally {
    resolve!();
  }
}
