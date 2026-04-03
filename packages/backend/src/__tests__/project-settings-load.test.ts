import { describe, it, expect } from "vitest";
import { MIN_VALIDATION_TIMEOUT_MS } from "@opensprint/shared";
import type { ProjectSettings } from "@opensprint/shared";
import { computeValidationTimeoutMs } from "../services/project/project-settings-load.js";
import { DEFAULT_VALIDATION_TIMEOUT_MS } from "../services/project/project-settings-helpers.js";

function baseSettings(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
  return {
    deployment: { mode: "custom" },
    aiAutonomyLevel: "balanced",
    hilConfig: {
      requireApprovalFor: { major_scope_changes: true, dependency_changes: true },
    },
    testFramework: null,
    testCommand: null,
    reviewMode: "full",
    gitWorkingMode: "worktree",
    worktreeBaseBranch: "main",
    maxConcurrentCoders: 1,
    mergeStrategy: "per_task",
    selfImprovementFrequency: "never",
    autoExecutePlans: false,
    runAgentEnhancementExperiments: false,
    teamMembers: [],
    simpleComplexityAgent: { type: "claude", model: "x", cliCommand: null },
    complexComplexityAgent: { type: "claude", model: "x", cliCommand: null },
    ...overrides,
  } as ProjectSettings;
}

describe("computeValidationTimeoutMs", () => {
  it("uses override when set", () => {
    const ms = computeValidationTimeoutMs(
      baseSettings({ validationTimeoutMsOverride: MIN_VALIDATION_TIMEOUT_MS }),
      "scoped"
    );
    expect(ms).toBe(MIN_VALIDATION_TIMEOUT_MS);
  });

  it("returns default when no samples", () => {
    expect(computeValidationTimeoutMs(baseSettings(), "scoped")).toBe(
      DEFAULT_VALIDATION_TIMEOUT_MS
    );
    expect(computeValidationTimeoutMs(baseSettings(), "full")).toBe(DEFAULT_VALIDATION_TIMEOUT_MS);
  });

  it("uses scoped samples for scoped scope", () => {
    const settings = baseSettings({
      validationTimingProfile: { scoped: [1000, 2000, 3000], full: [] },
    });
    const ms = computeValidationTimeoutMs(settings, "scoped");
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(600_000);
  });

  it("falls back from empty scoped to full for scoped scope", () => {
    const emptyProfile = baseSettings({
      validationTimingProfile: { scoped: [], full: [] },
    });
    const withFullOnly = baseSettings({
      validationTimingProfile: {
        scoped: [],
        full: [120_000, 125_000, 130_000],
      },
    });
    expect(computeValidationTimeoutMs(emptyProfile, "scoped")).toBe(DEFAULT_VALIDATION_TIMEOUT_MS);
    const fromFullFallback = computeValidationTimeoutMs(withFullOnly, "scoped");
    expect(fromFullFallback).not.toBe(DEFAULT_VALIDATION_TIMEOUT_MS);
    expect(fromFullFallback).toBe(computeValidationTimeoutMs(withFullOnly, "full"));
  });
});
