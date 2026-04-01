import { describe, expect, it } from "vitest";
import type { Plan } from "@opensprint/shared";
import {
  getPlanChatMessageDisplay,
  hasGeneratedPlanTasksForCurrentVersion,
  topologicalPlanOrder,
} from "./planPhaseUtils";

function planWithTaskFlag(flag: boolean | undefined): Plan {
  return {
    metadata: {
      planId: "p1",
      epicId: "e1",
      shippedAt: null,
      complexity: "medium",
    },
    content: "",
    status: "planning",
    taskCount: 0,
    doneTaskCount: 0,
    dependencyCount: 0,
    hasGeneratedPlanTasksForCurrentVersion: flag,
  };
}

describe("getPlanChatMessageDisplay", () => {
  it('replaces content containing [PLAN_UPDATE] with "Plan updated"', () => {
    expect(getPlanChatMessageDisplay("[PLAN_UPDATE]\n# Plan\n\nContent.\n[/PLAN_UPDATE]")).toBe(
      "Plan updated"
    );
  });

  it("returns original content when no plan update marker", () => {
    const content = "Hello world";
    expect(getPlanChatMessageDisplay(content)).toBe(content);
  });
});

describe("hasGeneratedPlanTasksForCurrentVersion", () => {
  it("is true only when flag is strictly true", () => {
    expect(hasGeneratedPlanTasksForCurrentVersion(planWithTaskFlag(true))).toBe(true);
    expect(hasGeneratedPlanTasksForCurrentVersion(planWithTaskFlag(false))).toBe(false);
    expect(hasGeneratedPlanTasksForCurrentVersion(planWithTaskFlag(undefined))).toBe(false);
  });
});

describe("topologicalPlanOrder", () => {
  it("orders so prerequisites come before dependents", () => {
    const ids = ["a", "b", "c"];
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];
    expect(topologicalPlanOrder(ids, edges)).toEqual(["a", "b", "c"]);
  });

  it("ignores edges outside the id set", () => {
    expect(topologicalPlanOrder(["x"], [{ from: "a", to: "b" }])).toEqual(["x"]);
  });

  it("returns a permutation of input ids", () => {
    const ids = ["p", "q", "r"];
    const out = topologicalPlanOrder(ids, []);
    expect(out.sort()).toEqual([...ids].sort());
  });
});
