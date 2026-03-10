/**
 * One-time migration: for each plan with current_version_number IS NULL,
 * insert one plan_versions row (v1) and set plans.current_version_number and
 * plans.last_executed_version_number. Idempotent: only processes rows where
 * current_version_number IS NULL.
 */

import type { DbClient } from "../db/client.js";
import { toPgParams } from "../db/sql-params.js";

/** Extract title from first markdown heading (# or ## ...) in content. */
export function titleFromFirstHeading(content: string): string | null {
  const line = content.split("\n").find((l) => /^#+\s+/.test(l.trim()));
  if (!line) return null;
  const match = line.trim().match(/^#+\s+(.+)$/);
  return match ? match[1].trim() || null : null;
}

/** Plan row selected for migration (current_version_number IS NULL). */
interface PlanRow {
  project_id: string;
  plan_id: string;
  content: string;
  metadata: string;
  shipped_content: string | null;
  updated_at: string;
}

/** Whether the plan is considered "executed" (has shipped content or shippedAt). */
function isExecuted(row: PlanRow): boolean {
  if (row.shipped_content != null && row.shipped_content.trim() !== "") return true;
  try {
    const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata;
    return meta?.shippedAt != null;
  } catch {
    return false;
  }
}

/**
 * Run the migration. Only processes plans where current_version_number IS NULL.
 * For each: insert plan_versions (version_number=1, title from first #, content, metadata,
 * created_at=updated_at, is_executed_version=1 if shipped else 0); then set
 * plans.current_version_number=1 and plans.last_executed_version_number=1 or null.
 */
export async function migratePlanVersions(client: DbClient): Promise<{ migrated: number }> {
  const rows = await client.query(
    toPgParams(
      `SELECT project_id, plan_id, content, metadata, shipped_content, updated_at
       FROM plans
       WHERE current_version_number IS NULL`
    ),
    []
  );

  if (rows.length === 0) return { migrated: 0 };

  let migrated = 0;
  for (const row of rows as unknown as PlanRow[]) {
    const projectId = String(row.project_id ?? "");
    const planId = String(row.plan_id ?? "");
    const content = String(row.content ?? "");
    const metadata = String(row.metadata ?? "{}");
    const updatedAt = String(row.updated_at ?? new Date().toISOString());
    const shippedContent = row.shipped_content != null ? String(row.shipped_content) : null;

    const executed = isExecuted({
      project_id: projectId,
      plan_id: planId,
      content,
      metadata,
      shipped_content: shippedContent,
      updated_at: updatedAt,
    });
    const title = titleFromFirstHeading(content);
    const isExecutedVersion = executed ? 1 : 0;

    await client.execute(
      toPgParams(
        `INSERT INTO plan_versions (project_id, plan_id, version_number, title, content, metadata, created_at, is_executed_version)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?)`
      ),
      [projectId, planId, title ?? null, content, metadata, updatedAt, isExecutedVersion]
    );

    await client.execute(
      toPgParams(
        `UPDATE plans
         SET current_version_number = 1, last_executed_version_number = ?
         WHERE project_id = ? AND plan_id = ?`
      ),
      [executed ? 1 : null, projectId, planId]
    );
    migrated++;
  }

  return { migrated };
}
