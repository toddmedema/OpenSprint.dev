import { describe, expect, it } from "vitest";
import { humanizeEnvironmentSetupQualityGate } from "../quality-gate-environment-humanize.js";

describe("humanizeEnvironmentSetupQualityGate", () => {
  it("returns null when category is not environment_setup", () => {
    expect(
      humanizeEnvironmentSetupQualityGate({
        category: "quality_gate",
        reason: "Validation workspace node_modules is missing or empty at /tmp/x",
      })
    ).toBeNull();
  });

  it("maps validation workspace node_modules message", () => {
    const path =
      "/var/folders/x/opensprint-validation/merged_candidate-abc/node_modules";
    const result = humanizeEnvironmentSetupQualityGate({
      category: "environment_setup",
      reason: `Validation workspace node_modules is missing or empty at ${path}`,
      validationWorkspace: "merged_candidate",
    });
    expect(result?.userTitle).toBe("Dependencies missing in merge check");
    expect(result?.userSummary).toMatch(/temporary merge preview/i);
  });

  it("maps npm ci repair output", () => {
    const result = humanizeEnvironmentSetupQualityGate({
      category: "environment_setup",
      reason: "[npm ci @ /var/folders/x/repo] some error",
    });
    expect(result?.userTitle).toBe("Dependency install failed");
  });

  it("uses merge preview fallback for opensprint-validation paths", () => {
    const result = humanizeEnvironmentSetupQualityGate({
      category: "environment_setup",
      reason: "Something odd at /var/folders/y/opensprint-validation/merged_candidate-z/wt",
    });
    expect(result?.userTitle).toBe("Merge check environment");
  });

  it("uses generic fallback for environment_setup with no rule match", () => {
    const result = humanizeEnvironmentSetupQualityGate({
      category: "environment_setup",
      reason: "Totally unknown internal error xyz",
      validationWorkspace: "task_worktree",
    });
    expect(result?.userTitle).toBe("Environment setup issue");
  });
});
