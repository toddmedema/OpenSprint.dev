/**
 * Plan versioning helpers: ensure at least one version exists, version number/title helpers.
 * Persistence is delegated to a store adapter so this module does not depend on task-store.
 */
import { titleFromFirstHeading } from "../migrate-plan-versions.service.js";
import type { PlanVersionInsert } from "../plan-version-store.service.js";

export interface PlanVersioningStore {
  listPlanVersions(projectId: string, planId: string): Promise<Array<{ version_number: number }>>;
  planGet(
    projectId: string,
    planId: string
  ): Promise<{ content: string; metadata: unknown } | null>;
  planVersionInsert(data: PlanVersionInsert): Promise<unknown>;
  planUpdateVersionNumbers(
    projectId: string,
    planId: string,
    updates: { current_version_number?: number; last_executed_version_number?: number }
  ): Promise<void>;
}

/**
 * Ensure the plan has at least one version. When there are no versions (e.g. first load),
 * create version 1 from current plan content so the version dropdown and execute flow are consistent.
 *
 * For sub-plans: call once per new child plan after its row is persisted so `plan_versions` v1 matches
 * that plan’s scoped markdown; parent and sibling plans are unaffected (separate `plan_id` rows).
 */
export async function ensurePlanHasAtLeastOneVersion(
  projectId: string,
  planId: string,
  store: PlanVersioningStore
): Promise<void> {
  const versions = await store.listPlanVersions(projectId, planId);
  if (versions.length > 0) return;
  const row = await store.planGet(projectId, planId);
  if (!row) return;
  const metadataJson =
    typeof row.metadata === "string" ? row.metadata : JSON.stringify(row.metadata ?? {});
  const title = titleFromFirstHeading(row.content);
  await store.planVersionInsert({
    project_id: projectId,
    plan_id: planId,
    version_number: 1,
    title: title ?? null,
    content: row.content,
    metadata: metadataJson,
    is_executed_version: false,
  });
  await store.planUpdateVersionNumbers(projectId, planId, {
    current_version_number: 1,
  });
}
