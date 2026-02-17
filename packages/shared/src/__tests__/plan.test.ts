import { describe, it, expect } from "vitest";
import { sortPlansByStatus } from "../types/plan.js";
import type { Plan, PlanStatus } from "../types/plan.js";

function createPlan(id: string, status: PlanStatus): Plan {
  return {
    metadata: {
      planId: id,
      beadEpicId: `epic-${id}`,
      gateTaskId: `${id}.0`,
      shippedAt: null,
      complexity: "medium",
    },
    content: `# ${id}`,
    status,
    taskCount: 1,
    doneTaskCount: 0,
    dependencyCount: 0,
  };
}

describe("sortPlansByStatus", () => {
  it("sorts plans by status order: planning → building → complete", () => {
    const plans = [
      createPlan("plan-done", "complete"),
      createPlan("plan-planning", "planning"),
      createPlan("plan-building", "building"),
    ];
    const sorted = sortPlansByStatus(plans);
    expect(sorted.map((p) => p.status)).toEqual(["planning", "building", "complete"]);
    expect(sorted.map((p) => p.metadata.planId)).toEqual(["plan-planning", "plan-building", "plan-done"]);
  });

  it("preserves relative order within same status", () => {
    const plans = [
      createPlan("plan-a", "building"),
      createPlan("plan-b", "building"),
      createPlan("plan-c", "planning"),
    ];
    const sorted = sortPlansByStatus(plans);
    expect(sorted.map((p) => p.metadata.planId)).toEqual(["plan-c", "plan-a", "plan-b"]);
  });

  it("returns new array without mutating input", () => {
    const plans = [
      createPlan("plan-done", "complete"),
      createPlan("plan-planning", "planning"),
    ];
    const sorted = sortPlansByStatus(plans);
    expect(sorted).not.toBe(plans);
    expect(plans.map((p) => p.status)).toEqual(["complete", "planning"]);
  });

  it("handles empty array", () => {
    expect(sortPlansByStatus([])).toEqual([]);
  });
});
