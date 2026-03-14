/**
 * Plan versioning: ensure at least one version, create version on update, resolve content/version for ship, set executed version.
 * Encapsulates all version table and plan version-number logic; used by PlanCrudService (update) and PlanShipService (ship).
 */
import type { Plan } from "@opensprint/shared";
import { getEpicTitleFromPlanContent } from "./plan/planner-normalize.js";
import { ensurePlanHasAtLeastOneVersion as ensurePlanHasAtLeastOneVersionImpl } from "./plan/plan-versioning.js";
import { titleFromFirstHeading } from "./migrate-plan-versions.service.js";

export interface PlanVersioningStore {
  listPlanVersions(projectId: string, planId: string): Promise<Array<{ version_number: number }>>;
  planGet(
    projectId: string,
    planId: string
  ): Promise<{
    content: string;
    metadata: unknown;
    current_version_number?: number;
  } | null>;
  planVersionInsert(data: {
    project_id: string;
    plan_id: string;
    version_number: number;
    title: string | null;
    content: string;
    metadata: string;
    is_executed_version?: boolean;
  }): Promise<unknown>;
  planVersionUpdateContent(
    projectId: string,
    planId: string,
    versionNumber: number,
    content: string,
    title?: string | null
  ): Promise<void>;
  planVersionGetByVersionNumber(
    projectId: string,
    planId: string,
    versionNumber: number
  ): Promise<{ content: string }>;
  planVersionList(projectId: string, planId: string): Promise<Array<{ version_number: number }>>;
  planUpdateContent(
    projectId: string,
    planId: string,
    content: string,
    currentVersionNumber?: number
  ): Promise<void>;
  planUpdateVersionNumbers(
    projectId: string,
    planId: string,
    updates: { current_version_number?: number; last_executed_version_number?: number | null }
  ): Promise<void>;
  planVersionSetExecutedVersion(
    projectId: string,
    planId: string,
    versionNumber: number
  ): Promise<void>;
}

export interface PlanVersioningRow {
  content: string;
  metadata: unknown;
  current_version_number?: number;
}

/**
 * Ensure the plan has at least one version (creates v1 from current content if none).
 */
export async function ensurePlanHasAtLeastOneVersion(
  projectId: string,
  planId: string,
  store: PlanVersioningStore
): Promise<void> {
  return ensurePlanHasAtLeastOneVersionImpl(projectId, planId, store);
}

/**
 * Update the current plan version in place (no new version). Use when the current version has no tasks yet.
 * Rule: create a new plan version only when the current version already has ≥1 task; otherwise modify in place.
 * Ensures at least one version exists, then updates that version's content/title. Returns the version number (unchanged).
 * Caller must call store.planUpdateContent(projectId, planId, newContent, versionNumber).
 */
export async function updateCurrentVersionInPlace(
  projectId: string,
  planId: string,
  row: PlanVersioningRow,
  newContent: string,
  store: PlanVersioningStore
): Promise<number> {
  await ensurePlanHasAtLeastOneVersion(projectId, planId, store);
  const versionNumber = row.current_version_number ?? 1;
  const title = titleFromFirstHeading(newContent) ?? null;
  await store.planVersionUpdateContent(projectId, planId, versionNumber, newContent, title);
  return versionNumber;
}

/**
 * Create a new plan version for an update. Use only when the current version already has ≥1 task (otherwise caller should use updateCurrentVersionInPlace).
 * If no versions exist, creates v1 from current row content, then creates nextVersion from newContent.
 * Returns the version number that was written for newContent. Caller must call store.planUpdateContent(projectId, planId, newContent, nextVersion).
 */
export async function createVersionOnUpdate(
  projectId: string,
  planId: string,
  row: PlanVersioningRow,
  newContent: string,
  store: PlanVersioningStore
): Promise<number> {
  const currentVersion = row.current_version_number ?? 1;
  const metadataJson =
    typeof row.metadata === "string" ? row.metadata : JSON.stringify(row.metadata ?? {});
  const versions = await store.listPlanVersions(projectId, planId);

  if (versions.length === 0) {
    const titleV1 = titleFromFirstHeading(row.content);
    await store.planVersionInsert({
      project_id: projectId,
      plan_id: planId,
      version_number: 1,
      title: titleV1 ?? null,
      content: row.content,
      metadata: metadataJson,
      is_executed_version: false,
    });
  }

  const nextVersion = currentVersion + 1;
  const title = titleFromFirstHeading(newContent);
  await store.planVersionInsert({
    project_id: projectId,
    plan_id: planId,
    version_number: nextVersion,
    title: title ?? null,
    content: newContent,
    metadata: metadataJson,
    is_executed_version: false,
  });
  return nextVersion;
}

export interface GetContentAndVersionForShipResult {
  versionContent: string;
  versionToExecute: number;
}

/**
 * Resolve which version content to use for ship and which version number to mark as executed.
 * When version_number is in options, uses that version's content and number.
 * Otherwise: if latest version content matches plan.content, use latest; else create next version with plan.content and use it.
 * When no versions exist, creates v1 from plan.content and uses it.
 */
export async function getContentAndVersionForShip(
  projectId: string,
  planId: string,
  plan: Pick<Plan, "content" | "metadata">,
  options: { version_number?: number } | undefined,
  store: PlanVersioningStore
): Promise<GetContentAndVersionForShipResult> {
  const versionNumberParam = options?.version_number;

  if (versionNumberParam != null) {
    const versionRow = await store.planVersionGetByVersionNumber(
      projectId,
      planId,
      versionNumberParam
    );
    return {
      versionContent: versionRow.content,
      versionToExecute: versionNumberParam,
    };
  }

  const versions = await store.planVersionList(projectId, planId);
  const latest = versions[0];

  if (latest) {
    const fullLatest = await store.planVersionGetByVersionNumber(
      projectId,
      planId,
      latest.version_number
    );
    if (fullLatest.content === plan.content) {
      return {
        versionContent: plan.content,
        versionToExecute: latest.version_number,
      };
    }
    // Content differs: create next version
    const nextVersion = latest.version_number + 1;
    const metadataJson = JSON.stringify(plan.metadata ?? {});
    await store.planVersionInsert({
      project_id: projectId,
      plan_id: planId,
      version_number: nextVersion,
      title: getEpicTitleFromPlanContent(plan.content, planId) || null,
      content: plan.content,
      metadata: metadataJson,
      is_executed_version: false,
    });
    await store.planUpdateVersionNumbers(projectId, planId, {
      current_version_number: nextVersion,
    });
    return {
      versionContent: plan.content,
      versionToExecute: nextVersion,
    };
  }

  // No versions: create v1
  const metadataJson = JSON.stringify(plan.metadata ?? {});
  await store.planVersionInsert({
    project_id: projectId,
    plan_id: planId,
    version_number: 1,
    title: getEpicTitleFromPlanContent(plan.content, planId) || null,
    content: plan.content,
    metadata: metadataJson,
    is_executed_version: false,
  });
  await store.planUpdateVersionNumbers(projectId, planId, {
    current_version_number: 1,
  });
  return {
    versionContent: plan.content,
    versionToExecute: 1,
  };
}

/**
 * Set the given version as the executed version for the plan (updates plan_versions and plans.last_executed_version_number).
 */
export async function setExecutedVersion(
  projectId: string,
  planId: string,
  versionToExecute: number,
  store: PlanVersioningStore
): Promise<void> {
  await store.planVersionSetExecutedVersion(projectId, planId, versionToExecute);
  await store.planUpdateVersionNumbers(projectId, planId, {
    last_executed_version_number: versionToExecute,
  });
}
