import { describe, expect, it } from "vitest";
import {
  QUALITY_GATE_FAILURE_MESSAGE,
  REMEDIATION_ENVIRONMENT_SETUP,
  REMEDIATION_PREFLIGHT_DEPENDENCY,
  REMEDIATION_PREFLIGHT_GIT,
  getErrorCodeHint,
  getQualityGateFailureLabel,
  getFailureTypeTitle,
  getQualityGateTitle,
  getRemediationForFailureType,
} from "@opensprint/shared";

describe("getErrorCodeHint", () => {
  it("returns hint for known error code", () => {
    expect(getErrorCodeHint("NO_EPIC")).toBe(
      "Plan has no epic. Use Generate Tasks to generate tasks first."
    );
    expect(getErrorCodeHint("AGENT_INVOKE_FAILED")).toBe(
      "Check agent login or Project Settings → Agent Config."
    );
    expect(getErrorCodeHint("PLAN_DEPTH_EXCEEDED")).toContain("four levels");
  });

  it("returns null for unknown code", () => {
    expect(getErrorCodeHint("UNKNOWN_CODE")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(getErrorCodeHint(undefined)).toBeNull();
  });
});

describe("getFailureTypeTitle", () => {
  it("returns title for environment_setup", () => {
    expect(getFailureTypeTitle("environment_setup")).toBe("Environment setup failed");
  });

  it("returns title for quality_gate", () => {
    expect(getFailureTypeTitle("quality_gate")).toBe("Quality gate failed");
  });

  it("returns title for repo_preflight", () => {
    expect(getFailureTypeTitle("repo_preflight")).toBe("Repo preflight failed");
  });

  it("falls back to the raw type when the label is unknown", () => {
    expect(getFailureTypeTitle("mystery_failure" as never)).toBe("mystery_failure");
  });
});

describe("getQualityGateFailureLabel", () => {
  it("returns the environment-specific label when setup failed", () => {
    expect(getQualityGateFailureLabel("environment_setup")).toBe("Environment setup failed");
  });

  it("returns the quality-gate label for merge-quality failures", () => {
    expect(getQualityGateFailureLabel("merge_quality_gate")).toBe("Quality gate failed");
  });
});

describe("getQualityGateTitle", () => {
  it("returns Quality gate failed when not blocked", () => {
    expect(getQualityGateTitle(false)).toBe("Quality gate failed");
  });

  it("returns Quality gate blocked when blocked", () => {
    expect(getQualityGateTitle(true)).toBe("Quality gate blocked");
  });
});

describe("getRemediationForFailureType", () => {
  it("returns environment setup remediation for environment_setup", () => {
    expect(getRemediationForFailureType("environment_setup")).toBe(REMEDIATION_ENVIRONMENT_SETUP);
  });

  it("returns dependency remediation for repo_preflight when dependency preflight", () => {
    expect(getRemediationForFailureType("repo_preflight", true)).toBe(
      REMEDIATION_PREFLIGHT_DEPENDENCY
    );
  });

  it("returns git remediation for repo_preflight when not dependency preflight", () => {
    expect(getRemediationForFailureType("repo_preflight", false)).toBe(REMEDIATION_PREFLIGHT_GIT);
  });
});

describe("QUALITY_GATE_FAILURE_MESSAGE", () => {
  it("exports expected message", () => {
    expect(QUALITY_GATE_FAILURE_MESSAGE).toContain("Pre-merge quality gates failed");
  });
});
