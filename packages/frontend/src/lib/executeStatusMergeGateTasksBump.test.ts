import { describe, it, expect, beforeEach } from "vitest";
import {
  resetMergeGateExecuteStatusSnapshots,
  shouldBumpTasksListForMergeGateStatus,
  snapshotExecuteStatusMergeGateFields,
} from "./executeStatusMergeGateTasksBump";

describe("executeStatusMergeGateTasksBump", () => {
  beforeEach(() => {
    resetMergeGateExecuteStatusSnapshots();
  });

  it("returns true on first snapshot per project then false when unchanged", () => {
    const snap = snapshotExecuteStatusMergeGateFields({
      gitMergeQueue: { activeTaskId: null, pendingTaskIds: [] },
      mergeValidationStatus: "healthy",
    });
    expect(shouldBumpTasksListForMergeGateStatus("p1", snap)).toBe(true);
    expect(shouldBumpTasksListForMergeGateStatus("p1", snap)).toBe(false);
  });

  it("tracks projects independently", () => {
    const a = snapshotExecuteStatusMergeGateFields({ baselineStatus: "ok" });
    const b = snapshotExecuteStatusMergeGateFields({ baselineStatus: "failing" });
    expect(shouldBumpTasksListForMergeGateStatus("p1", a)).toBe(true);
    expect(shouldBumpTasksListForMergeGateStatus("p2", b)).toBe(true);
    expect(shouldBumpTasksListForMergeGateStatus("p1", a)).toBe(false);
  });

  it("returns true when merge-related payload changes", () => {
    const s1 = snapshotExecuteStatusMergeGateFields({ gitMergeQueue: null });
    const s2 = snapshotExecuteStatusMergeGateFields({
      gitMergeQueue: { activeTaskId: "t1", pendingTaskIds: [] },
    });
    expect(shouldBumpTasksListForMergeGateStatus("p1", s1)).toBe(true);
    expect(shouldBumpTasksListForMergeGateStatus("p1", s2)).toBe(true);
  });
});
