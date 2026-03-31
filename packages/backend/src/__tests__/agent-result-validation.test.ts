import { describe, it, expect } from "vitest";
import {
  parseCodingAgentResult,
  parseReviewAgentResult,
  parseMergerAgentResult,
} from "../services/agent-result-validation.js";

describe("parseCodingAgentResult with debugArtifact", () => {
  it("extracts debugArtifact when present in result JSON", () => {
    const result = parseCodingAgentResult(
      JSON.stringify({
        status: "success",
        summary: "Implemented the feature",
        debugArtifact: {
          rootCauseCategory: "code_defect",
          evidence: "Unused import caused lint failure",
          fixApplied: "Removed unused import",
          verificationCommand: "npm run lint",
          verificationPassed: true,
          residualRisk: null,
          nextAction: "continue",
        },
      })
    );

    expect(result).not.toBeNull();
    expect(result!.status).toBe("success");
    expect(result!.debugArtifact).toBeDefined();
    expect(result!.debugArtifact!.rootCauseCategory).toBe("code_defect");
    expect(result!.debugArtifact!.evidence).toBe("Unused import caused lint failure");
    expect(result!.debugArtifact!.verificationPassed).toBe(true);
  });

  it("returns result without debugArtifact when not present", () => {
    const result = parseCodingAgentResult(
      JSON.stringify({
        status: "success",
        summary: "Done",
      })
    );

    expect(result).not.toBeNull();
    expect(result!.debugArtifact).toBeUndefined();
  });

  it("ignores malformed debugArtifact without breaking parse", () => {
    const result = parseCodingAgentResult(
      JSON.stringify({
        status: "success",
        summary: "Done",
        debugArtifact: "not an object",
      })
    );

    expect(result).not.toBeNull();
    expect(result!.debugArtifact).toBeUndefined();
  });
});

describe("parseReviewAgentResult with debugArtifact", () => {
  it("extracts debugArtifact from review result", () => {
    const result = parseReviewAgentResult(
      JSON.stringify({
        status: "approved",
        summary: "Code looks good",
        debugArtifact: {
          rootCauseCategory: "env_defect",
          evidence: "node_modules was stale",
          fixApplied: "Ran npm ci",
          verificationCommand: "npm run test",
          verificationPassed: true,
          residualRisk: null,
          nextAction: "continue",
        },
      })
    );

    expect(result).not.toBeNull();
    expect(result!.debugArtifact).toBeDefined();
    expect(result!.debugArtifact!.rootCauseCategory).toBe("env_defect");
  });

  it("returns result without debugArtifact when not present", () => {
    const result = parseReviewAgentResult(
      JSON.stringify({
        status: "rejected",
        summary: "Tests fail",
        issues: ["Test x is broken"],
      })
    );

    expect(result).not.toBeNull();
    expect(result!.debugArtifact).toBeUndefined();
  });
});

describe("parseMergerAgentResult with debugArtifact", () => {
  it("extracts debugArtifact from merger result", () => {
    const result = parseMergerAgentResult(
      JSON.stringify({
        status: "success",
        summary: "Resolved conflicts",
        debugArtifact: {
          rootCauseCategory: "dependency_defect",
          evidence: "Conflicting package-lock.json",
          fixApplied: "Regenerated lockfile",
          verificationCommand: "npm ci && npm test",
          verificationPassed: true,
          residualRisk: null,
          nextAction: "continue",
        },
      })
    );

    expect(result).not.toBeNull();
    expect(result!.debugArtifact).toBeDefined();
    expect(result!.debugArtifact!.rootCauseCategory).toBe("dependency_defect");
  });

  it("returns result without debugArtifact when not present", () => {
    const result = parseMergerAgentResult(
      JSON.stringify({
        status: "success",
        summary: "Resolved all conflicts",
      })
    );

    expect(result).not.toBeNull();
    expect(result!.debugArtifact).toBeUndefined();
  });
});
