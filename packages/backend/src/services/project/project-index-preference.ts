import type { ProjectIndexEntry } from "@opensprint/shared";
import { getSettingsWithMetaFromStore } from "../settings-store.service.js";
import { buildDefaultSettings, isPreferredRepoPathEntry } from "./project-settings-helpers.js";

/** Pick the preferred index entry when multiple projects share a repo path. */
export async function resolvePreferredProjectEntry(
  entries: ProjectIndexEntry[]
): Promise<ProjectIndexEntry> {
  let preferred = entries[0]!;
  let preferredMeta = await getSettingsWithMetaFromStore(preferred.id, buildDefaultSettings());

  for (const entry of entries.slice(1)) {
    const entryMeta = await getSettingsWithMetaFromStore(entry.id, buildDefaultSettings());
    if (
      isPreferredRepoPathEntry(
        { updatedAt: entryMeta.updatedAt, createdAt: entry.createdAt },
        { updatedAt: preferredMeta.updatedAt, createdAt: preferred.createdAt }
      )
    ) {
      preferred = entry;
      preferredMeta = entryMeta;
    }
  }

  return preferred;
}
