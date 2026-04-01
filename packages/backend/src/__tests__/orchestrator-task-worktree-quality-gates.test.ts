import { describe, expect, it } from "vitest";
import type { PhaseResult } from "../services/orchestrator-phase-context.js";
import {
  applyQualityGateFailureToPhaseResult,
  clearQualityGateDetailOnPhase,
  formatOrchestratorQualityGateFailureReason,
  toRetryQualityGateDetail,
} from "../services/orchestrator-task-worktree-quality-gates.js";
import type { MergeQualityGateFailure } from "../services/merge-coordinator.service.js";

function emptyPhaseResult(): PhaseResult {
  return {
    codingDiff: "",
    codingSummary: "",
    testResults: null,
    testOutput: "",
    qualityGateDetail: null,
    mergeGateArtifactTaskWorktree: null,
  };
}

describe("orchestrator-task-worktree-quality-gates", () => {
  it("clearQualityGateDetailOnPhase clears detail", () => {
    const pr = emptyPhaseResult();
    pr.qualityGateDetail = { command: "x", reason: "y" };
    clearQualityGateDetailOnPhase(pr);
    expect(pr.qualityGateDetail).toBeNull();
  });

  it("toRetryQualityGateDetail maps MergeQualityGateFailure fields", () => {
    const failure: MergeQualityGateFailure = {
      command: "pnpm test",
      reason: "Assertion failed",
      output: "long output",
      outputSnippet: "short",
      firstErrorLine: "at test.ts:1",
      validationWorkspace: "task_worktree",
      category: "quality_gate",
      autoRepairAttempted: false,
      autoRepairSucceeded: false,
    };
    const d = toRetryQualityGateDetail(failure, "/repo");
    expect(d.command).toBe("pnpm test");
    expect(d.worktreePath).toBe("/repo");
    expect(d.validationWorkspace).toBe("task_worktree");
  });

  it("applyQualityGateFailureToPhaseResult mutates phase result", () => {
    const pr = emptyPhaseResult();
    const failure: MergeQualityGateFailure = {
      command: "npm run build",
      reason: "TS error",
      output: "error TS",
      outputSnippet: "error TS",
    };
    const detail = applyQualityGateFailureToPhaseResult(pr, failure, "/wt");
    expect(pr.qualityGateDetail).toEqual(detail);
    expect(pr.validationCommand).toBe("npm run build");
    expect(pr.testOutput).toBe("error TS");
  });

  it("formatOrchestratorQualityGateFailureReason uses environment_setup title when requested", () => {
    const s = formatOrchestratorQualityGateFailureReason(
      { command: "npm ci", reason: "ENOTFOUND", firstErrorLine: "network" },
      "environment_setup"
    );
    expect(s).toContain("npm ci");
    expect(s).toContain("Environment setup failed");
  });
});
