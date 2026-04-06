import { describe, expect, it } from "vitest";
import { MergeJobError } from "../services/git-commit-queue.service.js";
import {
  buildBaselineFailureFingerprint,
  buildBaselineQualityGateNotificationDetail,
  buildMergeQualityGateJobError,
  buildQualityGateStructuredDetails,
  getFirstNonEmptyLine,
  getQualityGateFailureDetailsFromMergeError,
  getQualityGateFirstErrorLine,
  isEnvironmentSetupQualityGateMergeError,
  toQualityGateOutputSnippet,
} from "../services/merge-quality-gate-failure-utils.js";
import { buildFailureFingerprint } from "../utils/failure-fingerprint.js";

describe("merge-quality-gate-failure-utils", () => {
  it("getFirstNonEmptyLine skips blanks", () => {
    expect(getFirstNonEmptyLine("\n  \nhello\n")).toBe("hello");
    expect(getFirstNonEmptyLine("   ")).toBeNull();
  });

  it("getQualityGateFirstErrorLine prefers explicit firstErrorLine", () => {
    expect(
      getQualityGateFirstErrorLine({
        command: "npm test",
        output: "other",
        firstErrorLine: "  explicit  ",
      })
    ).toBe("explicit");
  });

  it("getQualityGateFirstErrorLine falls back to output and reason", () => {
    expect(
      getQualityGateFirstErrorLine({
        command: "x",
        output: "\n\nfirst from output",
      })
    ).toBe("first from output");
    expect(
      getQualityGateFirstErrorLine({
        command: "x",
        reason: "from reason",
      })
    ).toBe("from reason");
  });

  it("toQualityGateOutputSnippet truncates via compactExecutionText", () => {
    const long = "x".repeat(5000);
    const snip = toQualityGateOutputSnippet(long);
    expect(snip).toBeTruthy();
    expect(snip!.length).toBeLessThan(long.length);
  });

  it("getQualityGateFailureDetailsFromMergeError reads MergeJobError attachment", () => {
    const err = new MergeJobError("fail", "quality_gate", [], "requeued", {
      command: "npm run lint",
      reason: "bad",
      outputSnippet: "out",
      firstErrorLine: "e1",
    });
    const d = getQualityGateFailureDetailsFromMergeError(err);
    expect(d?.command).toBe("npm run lint");
    expect(getQualityGateFailureDetailsFromMergeError(new Error("x"))).toBeNull();
  });

  it("isEnvironmentSetupQualityGateMergeError checks category", () => {
    const qg = new MergeJobError("f", "quality_gate", [], "requeued", {
      command: "c",
      reason: "r",
      outputSnippet: "o",
      firstErrorLine: "e",
      category: "environment_setup",
    });
    expect(isEnvironmentSetupQualityGateMergeError(qg)).toBe(true);
    const plain = new MergeJobError("f", "quality_gate", [], "requeued", {
      command: "c",
      reason: "r",
      outputSnippet: "o",
      firstErrorLine: "e",
      category: "quality_gate",
    });
    expect(isEnvironmentSetupQualityGateMergeError(plain)).toBe(false);
  });

  it("buildMergeQualityGateJobError preserves command and stage", () => {
    const job = buildMergeQualityGateJobError(
      {
        command: "npm test",
        reason: "failed",
        output: "stderr here",
      },
      "/tmp/wt"
    );
    expect(job).toBeInstanceOf(MergeJobError);
    expect(job.stage).toBe("quality_gate");
    expect(job.qualityGateFailure?.command).toBe("npm test");
    expect(job.qualityGateFailure?.worktreePath).toBe("/tmp/wt");
  });

  it("buildQualityGateStructuredDetails builds nested qualityGateDetail when any field set", () => {
    const structured = buildQualityGateStructuredDetails(
      {
        command: "t",
        reason: "r",
        outputSnippet: "o",
        firstErrorLine: "e",
        worktreePath: "/w",
        category: "quality_gate",
        validationWorkspace: "task_worktree",
      },
      "/fallback"
    );
    expect(structured.failedGateCommand).toBe("t");
    expect(structured.qualityGateDetail?.command).toBe("t");
    expect(structured.qualityGateDetail?.validationWorkspace).toBe("task_worktree");
  });

  it("buildBaselineFailureFingerprint is stable for same inputs", () => {
    const f = {
      command: " NPM test ",
      output: "err",
      firstErrorLine: "First",
      validationWorkspace: "task_worktree" as const,
      category: "quality_gate" as const,
    };
    expect(buildBaselineFailureFingerprint(f)).toBe(buildBaselineFailureFingerprint(f));
  });

  it("buildBaselineQualityGateNotificationDetail includes low-confidence note", () => {
    const text = buildBaselineQualityGateNotificationDetail({
      command: "npm ci",
      reason: "x",
      output: "y",
      firstErrorLine: "missing module",
      classificationConfidence: "low",
    });
    expect(text).toContain("low-confidence");
    expect(text).toContain("npm ci");
  });

  it("classifies rebase continue blocked messages as merge_conflict fingerprints", () => {
    const fp = buildFailureFingerprint(
      "Rebase continue blocked (preflight): unmerged paths remain: a.txt",
      "rebase_before_merge",
      "opensprint/os-xxxx"
    );
    expect(fp.failureClass).toBe("merge_conflict");
  });
});
