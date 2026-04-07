import { describe, expect, it } from "vitest";
import {
  VERIFY_MERGE_GATES_NPM_COMMAND,
  getMergeQualityGateExecutionPlan,
} from "../services/merge-quality-gates.js";

describe("getMergeQualityGateExecutionPlan", () => {
  it("expands verify:merge-gates into build, lint, test for deterministic profile", () => {
    const plan = getMergeQualityGateExecutionPlan({
      profile: "deterministic",
      testRunId: "tid",
      integrationWorkerCap: 2,
      toolchainProfile: {
        mergeQualityGateCommands: [VERIFY_MERGE_GATES_NPM_COMMAND],
        dependencyStrategy: "npm",
      },
    });
    expect(plan.map((e) => e.command)).toEqual([
      "npm run build",
      "npm run lint",
      "npm run test",
    ]);
    const testEntry = plan.find((e) => e.command === "npm run test");
    expect(testEntry?.env?.OPENSPRINT_MERGE_GATE_TEST_MODE).toBe("1");
    expect(testEntry?.env?.NODE_ENV).toBe("test");
    expect(testEntry?.env?.OPENSPRINT_VITEST_RUN_ID).toBe("tid");
  });

  it("does not expand multiple or different commands", () => {
    const plan = getMergeQualityGateExecutionPlan({
      profile: "deterministic",
      toolchainProfile: {
        mergeQualityGateCommands: ["npm run build", "npm run test"],
        dependencyStrategy: "npm",
      },
    });
    expect(plan.map((e) => e.command)).toEqual(["npm run build", "npm run test"]);
  });
});
