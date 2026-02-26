/**
 * ApiKeyResolver: resolves API keys for a project with rotation support.
 * - getNextKey(projectId, provider): first available key (no limitHitAt or >24h ago), or process.env fallback
 * - recordLimitHit(projectId, provider, keyId): set limitHitAt for the key (thread-safe)
 * - clearLimitHit(projectId, provider, keyId): clear limitHitAt on success (thread-safe)
 */
import type { ApiKeyProvider, ApiKeyEntry, ProjectSettings } from "@opensprint/shared";
import { isLimitHitExpired, DEFAULT_HIL_CONFIG, DEFAULT_DEPLOYMENT_CONFIG, DEFAULT_REVIEW_MODE } from "@opensprint/shared";
import {
  getSettingsFromStore,
  setSettingsInStore,
  updateSettingsInStore,
} from "./settings-store.service.js";

/** Synthetic keyId when falling back to process.env (recordLimitHit/clearLimitHit no-op) */
export const ENV_FALLBACK_KEY_ID = "__env__";

/** Minimal defaults for getSettingsFromStore when project has no stored settings */
function getMinimalDefaults(): ProjectSettings {
  const defaultAgent = { type: "cursor" as const, model: null as string | null, cliCommand: null as string | null };
  return {
    simpleComplexityAgent: defaultAgent,
    complexComplexityAgent: defaultAgent,
    deployment: { ...DEFAULT_DEPLOYMENT_CONFIG },
    hilConfig: { ...DEFAULT_HIL_CONFIG },
    testFramework: null,
    testCommand: null,
    reviewMode: DEFAULT_REVIEW_MODE,
    gitWorkingMode: "worktree",
  };
}

/** Result of getNextKey: key value and stable keyId for recordLimitHit/clearLimitHit */
export interface ResolvedKey {
  key: string;
  keyId: string;
}

/**
 * Get the next available API key for the given project and provider.
 * Uses first key without limitHitAt or with limitHitAt > 24h ago.
 * Falls back to process.env when project has no keys configured.
 * Returns null when no key is available (all keys have recent limitHitAt, or env empty).
 */
export async function getNextKey(
  projectId: string,
  provider: ApiKeyProvider
): Promise<ResolvedKey | null> {
  const settings = await getSettingsFromStore(projectId, getMinimalDefaults());
  const entries = settings.apiKeys?.[provider];

  if (entries && entries.length > 0) {
    const available = entries.find(
      (e) =>
        (!e.limitHitAt || isLimitHitExpired(e.limitHitAt)) && e.value.trim()
    );
    if (available) {
      return { key: available.value, keyId: available.id };
    }
    return null; // all keys have recent limitHitAt or empty value
  }

  // Fall back to process.env
  const envKey = process.env[provider];
  if (envKey && envKey.trim()) {
    return { key: envKey, keyId: ENV_FALLBACK_KEY_ID };
  }

  return null;
}

/**
 * Record that the given key hit a rate/limit. Sets limitHitAt to now.
 * Thread-safe: uses atomic read-modify-write via updateSettingsInStore.
 * No-op when keyId is ENV_FALLBACK_KEY_ID.
 */
export async function recordLimitHit(
  projectId: string,
  provider: ApiKeyProvider,
  keyId: string
): Promise<void> {
  if (keyId === ENV_FALLBACK_KEY_ID) return;

  await updateSettingsInStore(projectId, getMinimalDefaults(), (settings) => {
    const entries = settings.apiKeys?.[provider];
    if (!entries) return settings;

    const updated = entries.map((e) =>
      e.id === keyId ? { ...e, limitHitAt: new Date().toISOString() } : e
    );
    return {
      ...settings,
      apiKeys: {
        ...settings.apiKeys,
        [provider]: updated,
      },
    };
  });
}

/**
 * Clear limitHitAt for the given key on successful API use.
 * Thread-safe: uses atomic read-modify-write via updateSettingsInStore.
 * No-op when keyId is ENV_FALLBACK_KEY_ID.
 */
export async function clearLimitHit(
  projectId: string,
  provider: ApiKeyProvider,
  keyId: string
): Promise<void> {
  if (keyId === ENV_FALLBACK_KEY_ID) return;

  await updateSettingsInStore(projectId, getMinimalDefaults(), (settings) => {
    const entries = settings.apiKeys?.[provider];
    if (!entries) return settings;

    const updated = entries.map((e) => {
      if (e.id !== keyId) return e;
      const { limitHitAt, ...rest } = e;
      return rest as ApiKeyEntry;
    });
    return {
      ...settings,
      apiKeys: {
        ...settings.apiKeys,
        [provider]: updated,
      },
    };
  });
}
