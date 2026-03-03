import type { AgentType } from "@opensprint/shared";

export interface EnvKeysForDefaults {
  anthropic: boolean;
  cursor: boolean;
  openai: boolean;
}

/**
 * Returns the first provider for which the user has an API key, in deterministic order:
 * Claude first, then OpenAI, then Cursor. When no keys are configured, returns "claude"
 * (first in order) so the user sees a consistent default.
 */
export function getDefaultProviderFromEnvKeys(envKeys: EnvKeysForDefaults | null): AgentType {
  if (!envKeys) return "claude";
  if (envKeys.anthropic) return "claude";
  if (envKeys.openai) return "openai";
  if (envKeys.cursor) return "cursor";
  return "claude";
}

/**
 * True when the user has no API keys configured (anthropic, cursor, openai all false).
 */
export function hasNoApiKeys(envKeys: EnvKeysForDefaults | null): boolean {
  if (!envKeys) return false;
  return !envKeys.anthropic && !envKeys.cursor && !envKeys.openai;
}
