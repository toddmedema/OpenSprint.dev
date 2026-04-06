import { describe, expect, it } from "vitest";
import { getMergeQualityGateExecutionPlan } from "../services/merge-quality-gates.js";

describe("getMergeQualityGateExecutionPlan", () => {
  it("forwards NODE_ENV=test and merge-gate Vitest env for deterministic npm run test", () => {
    const plan = getMergeQualityGateExecutionPlan({
      profile: "deterministic",
      testRunId: "mergegate_fixture",
      integrationWorkerCap: 2,
    });
    const testEntry = plan.find((e) => e.command === "npm run test");
    expect(testEntry?.env).toEqual(
      expect.objectContaining({
        NODE_ENV: "test",
        OPENSPRINT_MERGE_GATE_TEST_MODE: "1",
        OPENSPRINT_VITEST_INTEGRATION_MAX_WORKERS: "2",
        OPENSPRINT_VITEST_RUN_ID: "mergegate_fixture",
      })
    );
  });

  it("does not set OPENSPRINT_VITEST_RUN_ID when testRunId is blank", () => {
    const plan = getMergeQualityGateExecutionPlan({
      profile: "deterministic",
      testRunId: "   ",
      integrationWorkerCap: 1,
    });
    const env = plan.find((e) => e.command === "npm run test")?.env;
    expect(env?.OPENSPRINT_VITEST_RUN_ID).toBeUndefined();
    expect(env?.NODE_ENV).toBe("test");
  });
});
