/**
 * Pure {@link BehaviorVersionStore} implementation (no task-store singleton).
 * Integration tests import this module so Vitest does not load `task-store.service` before
 * other suites' `vi.mock` factories (e.g. plan-route).
 */

import type { DbClient } from "../db/client.js";
import { toPgParams } from "../db/sql-params.js";

export class BehaviorVersionStore {
  constructor(private getClient: () => DbClient) {}

  /**
   * Record a promoted behavior version and set it as the active promoted version for Execute replay.
   */
  async promoteToActive(
    projectId: string,
    versionId: string,
    promotedAt: string,
    templateVersionId?: string | null
  ): Promise<void> {
    const client = this.getClient();
    const now = new Date().toISOString();
    const template = templateVersionId?.trim() ? templateVersionId.trim() : null;

    await client.execute(
      toPgParams(
        `INSERT INTO behavior_versions (id, project_id, template_version_id, promoted_at, created_at, bundle, version_type)
         VALUES (?, ?, ?, ?, ?, NULL, 'promoted')
         ON CONFLICT (project_id, id) DO UPDATE SET
           promoted_at = excluded.promoted_at,
           version_type = 'promoted',
           template_version_id = COALESCE(excluded.template_version_id, behavior_versions.template_version_id)`
      ),
      [versionId, projectId, template, promotedAt, now]
    );

    await client.execute(
      toPgParams(
        `INSERT INTO project_behavior_state (project_id, active_promoted_version_id)
         VALUES (?, ?)
         ON CONFLICT (project_id) DO UPDATE SET
           active_promoted_version_id = excluded.active_promoted_version_id`
      ),
      [projectId, versionId]
    );
  }

  /**
   * Point active promoted version at an existing promoted id (rollback / no new row).
   */
  async setActivePromoted(projectId: string, versionId: string): Promise<void> {
    const client = this.getClient();
    await client.execute(
      toPgParams(
        `INSERT INTO project_behavior_state (project_id, active_promoted_version_id)
         VALUES (?, ?)
         ON CONFLICT (project_id) DO UPDATE SET
           active_promoted_version_id = excluded.active_promoted_version_id`
      ),
      [projectId, versionId]
    );
  }

  /**
   * Ensure DB state matches project settings for the active promoted id and return template id from the store.
   */
  async resolveActiveForExecute(
    projectId: string,
    activeBehaviorVersionId: string | undefined,
    promotedVersions?: Array<{ id: string; promotedAt: string }>
  ): Promise<{ behaviorVersionId: string; templateVersionId?: string } | null> {
    const activeId = activeBehaviorVersionId?.trim();
    if (!activeId) return null;

    const client = this.getClient();

    const stateRow = await client.queryOne(
      toPgParams(
        `SELECT active_promoted_version_id FROM project_behavior_state WHERE project_id = ?`
      ),
      [projectId]
    );
    const stateActive =
      stateRow && typeof (stateRow as { active_promoted_version_id?: unknown }).active_promoted_version_id === "string"
        ? String((stateRow as { active_promoted_version_id: string }).active_promoted_version_id).trim()
        : "";

    const versionRow = await client.queryOne(
      toPgParams(`SELECT id FROM behavior_versions WHERE id = ? AND project_id = ?`),
      [activeId, projectId]
    );

    if (!versionRow || stateActive !== activeId) {
      const promotedAt =
        promotedVersions?.find((v) => v.id === activeId)?.promotedAt ?? new Date().toISOString();
      const now = new Date().toISOString();
      await client.execute(
        toPgParams(
          `INSERT INTO behavior_versions (id, project_id, template_version_id, promoted_at, created_at, bundle, version_type)
           VALUES (?, ?, NULL, ?, ?, NULL, 'promoted')
           ON CONFLICT (project_id, id) DO UPDATE SET
             promoted_at = COALESCE(behavior_versions.promoted_at, excluded.promoted_at),
             version_type = 'promoted'`
        ),
        [activeId, projectId, promotedAt, now]
      );
      await client.execute(
        toPgParams(
          `INSERT INTO project_behavior_state (project_id, active_promoted_version_id)
           VALUES (?, ?)
           ON CONFLICT (project_id) DO UPDATE SET
             active_promoted_version_id = excluded.active_promoted_version_id`
        ),
        [projectId, activeId]
      );
    }

    const tplRow = await client.queryOne(
      toPgParams(`SELECT template_version_id FROM behavior_versions WHERE id = ? AND project_id = ?`),
      [activeId, projectId]
    );
    const templateRaw =
      tplRow && typeof (tplRow as { template_version_id?: unknown }).template_version_id === "string"
        ? String((tplRow as { template_version_id: string }).template_version_id).trim()
        : "";
    return {
      behaviorVersionId: activeId,
      ...(templateRaw ? { templateVersionId: templateRaw } : {}),
    };
  }

  /**
   * Read the active promoted behavior id and template id from persisted store state only.
   * Used for Execute assignment replay metadata (no settings-based sync or insert).
   */
  async readActivePromotedReplayBinding(
    projectId: string
  ): Promise<{ behaviorVersionId: string; templateVersionId?: string } | null> {
    const client = this.getClient();
    const stateRow = await client.queryOne(
      toPgParams(
        `SELECT active_promoted_version_id FROM project_behavior_state WHERE project_id = ?`
      ),
      [projectId]
    );
    const activeRaw =
      stateRow && typeof (stateRow as { active_promoted_version_id?: unknown }).active_promoted_version_id === "string"
        ? String((stateRow as { active_promoted_version_id: string }).active_promoted_version_id).trim()
        : "";
    if (!activeRaw) return null;

    const tplRow = await client.queryOne(
      toPgParams(`SELECT template_version_id FROM behavior_versions WHERE id = ? AND project_id = ?`),
      [activeRaw, projectId]
    );
    const templateRaw =
      tplRow && typeof (tplRow as { template_version_id?: unknown }).template_version_id === "string"
        ? String((tplRow as { template_version_id: string }).template_version_id).trim()
        : "";

    return {
      behaviorVersionId: activeRaw,
      ...(templateRaw ? { templateVersionId: templateRaw } : {}),
    };
  }

  /**
   * Persist an experiment candidate bundle (not active until promoted). Overwrites same id.
   */
  async saveCandidate(projectId: string, versionId: string, bundleJson: string): Promise<void> {
    const client = this.getClient();
    const now = new Date().toISOString();
    await client.execute(
      toPgParams(
        `INSERT INTO behavior_versions (id, project_id, template_version_id, promoted_at, created_at, bundle, version_type)
         VALUES (?, ?, NULL, NULL, ?, ?, 'candidate')
         ON CONFLICT (project_id, id) DO UPDATE SET
           bundle = excluded.bundle,
           version_type = 'candidate',
           template_version_id = NULL,
           promoted_at = NULL,
           created_at = excluded.created_at`
      ),
      [versionId, projectId, now, bundleJson]
    );
  }
}
