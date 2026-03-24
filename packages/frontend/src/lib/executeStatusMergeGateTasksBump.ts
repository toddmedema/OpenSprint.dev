/**
 * When orchestrator merge-related fields change, refetch the task list so Redux (synced from
 * TanStack Query in ProjectShell) picks up server-derived merge gate columns without a full reload.
 * Dedupe by snapshot so idle execute.status ticks that only repeat queueDepth do not refetch.
 */

const lastSnapshotByProject = new Map<string, string>();

export type ExecuteStatusMergeGateSnapshotSource = {
  gitMergeQueue?: unknown;
  mergeValidationStatus?: unknown;
  mergeValidationFailureSummary?: unknown;
  baselineStatus?: unknown;
  baselineRemediationStatus?: unknown;
};

export function snapshotExecuteStatusMergeGateFields(ev: ExecuteStatusMergeGateSnapshotSource): string {
  return JSON.stringify({
    gmq: ev.gitMergeQueue ?? null,
    mv: ev.mergeValidationStatus ?? null,
    mvf: ev.mergeValidationFailureSummary ?? null,
    bs: ev.baselineStatus ?? null,
    br: ev.baselineRemediationStatus ?? null,
  });
}

/** Returns true when the snapshot changed for this project (caller should invalidate tasks list). */
export function shouldBumpTasksListForMergeGateStatus(
  projectId: string,
  snapshot: string
): boolean {
  const prev = lastSnapshotByProject.get(projectId);
  if (prev === snapshot) return false;
  lastSnapshotByProject.set(projectId, snapshot);
  return true;
}

/** Test helper: reset dedupe state between cases. */
export function resetMergeGateExecuteStatusSnapshots(): void {
  lastSnapshotByProject.clear();
}
