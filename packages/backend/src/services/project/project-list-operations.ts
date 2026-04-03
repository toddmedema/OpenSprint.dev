import fs from "fs/promises";
import path from "path";
import type { Project } from "@opensprint/shared";
import { OPENSPRINT_DIR } from "@opensprint/shared";
import { getSettingsWithMetaFromStore } from "../settings-store.service.js";
import * as projectIndex from "../project-index.js";
import {
  buildDefaultSettings,
  isPreferredRepoPathEntry,
  normalizeRepoPath,
} from "./project-settings-helpers.js";

export async function buildProjectListFromIndex(): Promise<Project[]> {
  const entries = await projectIndex.getProjects();
  const projectsByRepoPath = new Map<
    string,
    { project: Project; settingsUpdatedAt: string | null; createdAt: string }
  >();

  for (const entry of entries) {
    try {
      await fs.access(path.join(entry.repoPath, OPENSPRINT_DIR));
      const { updatedAt } = await getSettingsWithMetaFromStore(entry.id, buildDefaultSettings());
      const project: Project = {
        id: entry.id,
        name: entry.name,
        repoPath: entry.repoPath,
        currentPhase: "sketch",
        createdAt: entry.createdAt,
        updatedAt: updatedAt ?? entry.createdAt,
      };
      const normalizedRepoPath = normalizeRepoPath(entry.repoPath);
      const existing = projectsByRepoPath.get(normalizedRepoPath);

      if (
        !existing ||
        isPreferredRepoPathEntry(
          { updatedAt, createdAt: entry.createdAt },
          { updatedAt: existing.settingsUpdatedAt, createdAt: existing.createdAt }
        )
      ) {
        projectsByRepoPath.set(normalizedRepoPath, {
          project,
          settingsUpdatedAt: updatedAt,
          createdAt: entry.createdAt,
        });
      }
    } catch {
      // Project directory may no longer exist — skip it
    }
  }

  return Array.from(projectsByRepoPath.values(), (value) => value.project);
}
