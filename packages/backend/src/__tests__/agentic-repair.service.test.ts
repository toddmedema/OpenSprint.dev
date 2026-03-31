import { describe, it, expect } from "vitest";
import {
  buildFailureDebugPacket,
  formatDebugPacketForPrompt,
  parseDebugArtifact,
  suggestPolicyFromArtifact,
  summarizeDebugArtifact,
  buildRepairLoopOutcome,
} from "../services/agentic-repair.service.js";
import type { DebugArtifact } from "@opensprint/shared";

describe("buildFailureDebugPacket", () => {
  it("builds a packet with all fields populated", () => {
    const packet = buildFailureDebugPacket({
      phase: "coding",
      attempt: 2,
      command: "npm run test",
      cwd: "/tmp/worktree",
      exitCode: 1,
      signal: null,
      stdout: "Tests: 5 passed, 1 failed",
      stderr: "AssertionError: expected 1 to be 2",
      changedFiles: ["src/foo.ts", "src/foo.test.ts"],
      gitDiffSummary: "2 files changed, 10 insertions",
      failureType: "test_failure",
      previousAttemptSummaries: ["[test_failure] First attempt failed"],
    });

    expect(packet.phase).toBe("coding");
    expect(packet.attempt).toBe(2);
    expect(packet.command).toBe("npm run test");
    expect(packet.exitCode).toBe(1);
    expect(packet.stdoutSnippet).toContain("5 passed");
    expect(packet.stderrSnippet).toContain("AssertionError");
    expect(packet.changedFiles).toHaveLength(2);
    expect(packet.previousAttemptSummaries).toHaveLength(1);
  });

  it("truncates long snippets", () => {
    const longOutput = "x".repeat(5000);
    const packet = buildFailureDebugPacket({
      phase: "review",
      attempt: 1,
      command: null,
      cwd: null,
      exitCode: null,
      signal: null,
      stdout: longOutput,
      stderr: null,
      changedFiles: [],
      gitDiffSummary: null,
      failureType: "merge_quality_gate",
    });

    expect(packet.stdoutSnippet!.length).toBeLessThan(longOutput.length);
    expect(packet.stdoutSnippet).toContain("[truncated]");
    expect(packet.stderrSnippet).toBeNull();
  });

  it("handles null/empty inputs gracefully", () => {
    const packet = buildFailureDebugPacket({
      phase: "merge",
      attempt: 1,
      command: null,
      cwd: null,
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: null,
      changedFiles: [],
      gitDiffSummary: "",
      failureType: "unknown",
    });

    expect(packet.stdoutSnippet).toBeNull();
    expect(packet.stderrSnippet).toBeNull();
    expect(packet.gitDiffSummary).toBeNull();
    expect(packet.previousAttemptSummaries).toEqual([]);
  });
});

describe("formatDebugPacketForPrompt", () => {
  it("produces markdown with failure context and debug artifact instructions", () => {
    const packet = buildFailureDebugPacket({
      phase: "coding",
      attempt: 3,
      command: "npm run lint",
      cwd: "/work",
      exitCode: 1,
      signal: null,
      stdout: null,
      stderr: "error: unused variable",
      changedFiles: ["src/main.ts"],
      gitDiffSummary: null,
      failureType: "quality_gate",
      previousAttemptSummaries: ["[lint] First lint failure"],
    });

    const prompt = formatDebugPacketForPrompt(packet);

    expect(prompt).toContain("## Failure Context (Diagnose and Repair)");
    expect(prompt).toContain("npm run lint");
    expect(prompt).toContain("unused variable");
    expect(prompt).toContain("debugArtifact");
    expect(prompt).toContain("rootCauseCategory");
    expect(prompt).toContain("First lint failure");
    expect(prompt).toContain("src/main.ts");
  });

  it("omits empty sections", () => {
    const packet = buildFailureDebugPacket({
      phase: "merge",
      attempt: 1,
      command: null,
      cwd: null,
      exitCode: null,
      signal: null,
      stdout: null,
      stderr: null,
      changedFiles: [],
      gitDiffSummary: null,
      failureType: "unknown",
    });

    const prompt = formatDebugPacketForPrompt(packet);

    expect(prompt).not.toContain("### stderr");
    expect(prompt).not.toContain("### stdout");
    expect(prompt).not.toContain("### Changed files");
    expect(prompt).toContain("debugArtifact");
  });
});

describe("parseDebugArtifact", () => {
  it("parses a complete debug artifact", () => {
    const result = parseDebugArtifact({
      debugArtifact: {
        rootCauseCategory: "code_defect",
        evidence: "Unused variable on line 42",
        fixApplied: "Removed unused variable",
        verificationCommand: "npm run lint",
        verificationPassed: true,
        residualRisk: null,
        nextAction: "continue",
      },
    });

    expect(result).toBeDefined();
    expect(result!.rootCauseCategory).toBe("code_defect");
    expect(result!.evidence).toBe("Unused variable on line 42");
    expect(result!.fixApplied).toBe("Removed unused variable");
    expect(result!.verificationPassed).toBe(true);
    expect(result!.nextAction).toBe("continue");
  });

  it("parses snake_case field names", () => {
    const result = parseDebugArtifact({
      debug_artifact: {
        root_cause_category: "env_defect",
        evidence: "Missing node_modules",
        fix_applied: "Ran npm ci",
        verification_command: "npm run test",
        verification_passed: true,
        residual_risk: "None",
        next_action: "continue",
      },
    });

    expect(result).toBeDefined();
    expect(result!.rootCauseCategory).toBe("env_defect");
    expect(result!.fixApplied).toBe("Ran npm ci");
    expect(result!.nextAction).toBe("continue");
  });

  it("returns undefined when artifact is missing", () => {
    expect(parseDebugArtifact({})).toBeUndefined();
    expect(parseDebugArtifact(null)).toBeUndefined();
    expect(parseDebugArtifact(undefined)).toBeUndefined();
  });

  it("keeps artifact when evidence is empty but other fields are present", () => {
    const result = parseDebugArtifact({
      debugArtifact: {
        rootCauseCategory: "code_defect",
        evidence: "",
        fixApplied: "Applied a partial patch",
      },
    });
    expect(result).toBeDefined();
    expect(result!.evidence).toBe("No evidence provided.");
  });

  it("normalizes unknown rootCauseCategory to 'unknown'", () => {
    const result = parseDebugArtifact({
      debugArtifact: {
        rootCauseCategory: "invalid_category",
        evidence: "Something happened",
      },
    });

    expect(result).toBeDefined();
    expect(result!.rootCauseCategory).toBe("unknown");
  });

  it("normalizes invalid nextAction to 'escalate'", () => {
    const result = parseDebugArtifact({
      debugArtifact: {
        rootCauseCategory: "code_defect",
        evidence: "Found a bug",
        nextAction: "invalid_action",
      },
    });

    expect(result).toBeDefined();
    expect(result!.nextAction).toBe("escalate");
  });
});

describe("suggestPolicyFromArtifact", () => {
  it("returns 'continue' when verification passed and nextAction is continue", () => {
    const artifact: DebugArtifact = {
      rootCauseCategory: "code_defect",
      evidence: "Fixed it",
      fixApplied: "patched",
      verificationCommand: "npm test",
      verificationPassed: true,
      residualRisk: null,
      nextAction: "continue",
    };
    expect(suggestPolicyFromArtifact(artifact)).toBe("continue");
  });

  it("returns 'requeue' when nextAction is continue but verification did not pass", () => {
    const artifact: DebugArtifact = {
      rootCauseCategory: "code_defect",
      evidence: "Attempted fix",
      fixApplied: "partial",
      verificationCommand: "npm test",
      verificationPassed: false,
      residualRisk: null,
      nextAction: "continue",
    };
    expect(suggestPolicyFromArtifact(artifact)).toBe("requeue");
  });

  it("returns 'requeue' for retry", () => {
    const artifact: DebugArtifact = {
      rootCauseCategory: "env_defect",
      evidence: "Flaky",
      fixApplied: null,
      verificationCommand: null,
      verificationPassed: null,
      residualRisk: null,
      nextAction: "retry",
    };
    expect(suggestPolicyFromArtifact(artifact)).toBe("requeue");
  });

  it("returns 'escalate' for escalate", () => {
    const artifact: DebugArtifact = {
      rootCauseCategory: "external_blocker",
      evidence: "API is down",
      fixApplied: null,
      verificationCommand: null,
      verificationPassed: null,
      residualRisk: null,
      nextAction: "escalate",
    };
    expect(suggestPolicyFromArtifact(artifact)).toBe("escalate");
  });

  it("returns 'block' for block", () => {
    const artifact: DebugArtifact = {
      rootCauseCategory: "requirements_ambiguous",
      evidence: "Need clarification",
      fixApplied: null,
      verificationCommand: null,
      verificationPassed: null,
      residualRisk: null,
      nextAction: "block",
    };
    expect(suggestPolicyFromArtifact(artifact)).toBe("block");
  });

  it("returns null for null/undefined artifact", () => {
    expect(suggestPolicyFromArtifact(null)).toBeNull();
    expect(suggestPolicyFromArtifact(undefined)).toBeNull();
  });
});

describe("summarizeDebugArtifact", () => {
  it("returns a one-line summary", () => {
    const artifact: DebugArtifact = {
      rootCauseCategory: "dependency_defect",
      evidence: "Missing tinypool",
      fixApplied: "Ran npm ci to restore dependencies",
      verificationCommand: "npm test",
      verificationPassed: true,
      residualRisk: null,
      nextAction: "continue",
    };
    const summary = summarizeDebugArtifact(artifact);
    expect(summary).toContain("[dependency_defect]");
    expect(summary).toContain("npm ci");
    expect(summary).toContain("verified");
    expect(summary).toContain("next=continue");
  });

  it("returns null for null artifact", () => {
    expect(summarizeDebugArtifact(null)).toBeNull();
  });
});

describe("buildRepairLoopOutcome", () => {
  it("builds outcome with artifact", () => {
    const artifact: DebugArtifact = {
      rootCauseCategory: "code_defect",
      evidence: "test",
      fixApplied: "fix",
      verificationCommand: "npm test",
      verificationPassed: true,
      residualRisk: null,
      nextAction: "continue",
    };
    const outcome = buildRepairLoopOutcome({
      startedAt: Date.now() - 5000,
      debugArtifact: artifact,
      repairLog: "Ran npm ci, then npm test",
    });

    expect(outcome.iterations).toBe(1);
    expect(outcome.wallTimeMs).toBeGreaterThanOrEqual(0);
    expect(outcome.finalVerificationPassed).toBe(true);
    expect(outcome.debugArtifact).toBe(artifact);
  });

  it("builds outcome without artifact", () => {
    const outcome = buildRepairLoopOutcome({
      startedAt: Date.now(),
      debugArtifact: null,
      repairLog: "",
    });

    expect(outcome.finalVerificationPassed).toBe(false);
    expect(outcome.debugArtifact).toBeNull();
  });
});
