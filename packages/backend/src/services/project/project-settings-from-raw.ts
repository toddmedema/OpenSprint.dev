import type { ProjectSettings } from "@opensprint/shared";
import {
  applyGlobalAgentDefaultsToRawRecord,
  parseSettings,
  projectStoredDefinesComplexAgent,
  projectStoredDefinesSimpleAgent,
} from "@opensprint/shared";
import type { getGlobalSettings } from "../global-settings.service.js";
import { toCanonicalSettings } from "./project-settings-helpers.js";

/** Merge global agent defaults into raw JSON, parse, and annotate inheritance for API responses. */
export function projectSettingsFromRaw(
  raw: Record<string, unknown>,
  gs: Awaited<ReturnType<typeof getGlobalSettings>>
): ProjectSettings {
  const normalized = applyGlobalAgentDefaultsToRawRecord(raw, gs);
  const parsed = toCanonicalSettings(parseSettings(normalized));
  return {
    ...parsed,
    simpleComplexityAgentInherited: !projectStoredDefinesSimpleAgent(raw),
    complexComplexityAgentInherited: !projectStoredDefinesComplexAgent(raw),
  };
}
