import { describe, expect, it } from "vitest";
import type { Plan } from "@opensprint/shared";
import {
  computePlanDetailPlanTasksHint,
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

function basePlan(
  id: string,
  overrides: Partial<Plan> & { metadata?: Partial<Plan["metadata"]> } = {}
): Plan {
  const { metadata: metaOverrides, ...rest } = overrides;
  return {
    metadata: {
      planId: id,
      epicId: `epic-${id}`,
      shippedAt: null,
      complexity: "medium",
      ...metaOverrides,
    },
    content: `# ${id}\n`,
    status: "planning",
    taskCount: 0,
    doneTaskCount: 0,
    dependencyCount: 0,
    ...rest,
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

describe("computePlanDetailPlanTasksHint", () => {
  it("does not set prominent Generate when a child plan already has sub-plans (delegate only)", () => {
    const subLeaf = basePlan("sub-leaf", {
      taskCount: 0,
      hasGeneratedPlanTasksForCurrentVersion: false,
      metadata: { planId: "sub-leaf", epicId: "e-sub", shippedAt: null, complexity: "medium" },
    });
    const intermediate = basePlan("mid", {
      parentPlanId: "root",
      metadata: {
        planId: "mid",
        epicId: "e-mid",
        shippedAt: null,
        complexity: "medium",
        parentPlanId: "root",
      },
      childPlanIds: ["sub-leaf"],
      taskCount: 0,
      hasGeneratedPlanTasksForCurrentVersion: false,
    });
    const plans = [intermediate, subLeaf];
    const hint = computePlanDetailPlanTasksHint(intermediate, plans, undefined);
    expect(hint?.showParentDelegateSubplans).toBe(true);
    expect(hint?.showProminentGenerateTasks).toBeFalsy();
  });

  it("sets prominent Generate for a leaf child with no sub-plans and no tasks yet", () => {
    const leafChild = basePlan("leaf", {
      parentPlanId: "root",
      metadata: {
        planId: "leaf",
        epicId: "e-leaf",
        shippedAt: null,
        complexity: "medium",
        parentPlanId: "root",
      },
      taskCount: 0,
      hasGeneratedPlanTasksForCurrentVersion: false,
      childPlanIds: [],
    });
    const hint = computePlanDetailPlanTasksHint(leafChild, [leafChild], undefined);
    expect(hint?.showProminentGenerateTasks).toBe(true);
    expect(hint?.showParentDelegateSubplans).toBeFalsy();
  });

  it("sets showAllSubplansHaveTasks when every child has tasks or generated flag", () => {
    const c1 = basePlan("c1", {
      taskCount: 2,
      hasGeneratedPlanTasksForCurrentVersion: false,
    });
    const c2 = basePlan("c2", {
      taskCount: 0,
      hasGeneratedPlanTasksForCurrentVersion: true,
    });
    const parent = basePlan("parent", {
      childPlanIds: ["c1", "c2"],
      taskCount: 0,
      hasGeneratedPlanTasksForCurrentVersion: false,
    });
    const hint = computePlanDetailPlanTasksHint(parent, [parent, c1, c2], undefined);
    expect(hint?.showAllSubplansHaveTasks).toBe(true);
  });

  it("sets blockedBy when a non-complete plan blocks the selected plan", () => {
    const blocker = basePlan("blocker", {
      content: "# Upstream\n",
      status: "planning",
    });
    const blocked = basePlan("blocked", {
      taskCount: 0,
      hasGeneratedPlanTasksForCurrentVersion: false,
    });
    const edges = [{ from: "blocker", to: "blocked", type: "blocks" as const }];
    const hint = computePlanDetailPlanTasksHint(blocked, [blocked, blocker], edges);
    expect(hint?.blockedBy).toEqual([{ planId: "blocker", title: "Upstream" }]);
  });

  it("sets showTooLarge when tooLargeForLeaf or failedPlanIds includes self", () => {
    const p = basePlan("self", { tooLargeForLeaf: true });
    expect(computePlanDetailPlanTasksHint(p, [p], undefined)?.showTooLarge).toBe(true);
    const q = basePlan("self2", { failedPlanIds: ["self2"] });
    expect(computePlanDetailPlanTasksHint(q, [q], undefined)?.showTooLarge).toBe(true);
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
