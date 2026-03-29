import { describe, expect, it } from "vitest";
import { sortPlansByStatus } from "../types/plan.js";
import type {
  Plan,
  PlanMetadata,
  PlanStatus,
  PlanVersionSummary,
  PlanVersionContent,
  CreatePlanRequest,
  PlanHierarchyNode,
  PlanHierarchyResponse,
} from "../types/plan.js";
import { PLAN_STATUS_ORDER } from "../constants/index.js";

function createPlan(id: string, status: PlanStatus): Plan {
  return {
    metadata: {
      planId: id,
      epicId: `epic-${id}`,
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

describe("Plan version types", () => {
  it("PlanVersionSummary has id, version_number, created_at, optional is_executed_version", () => {
    const summary: PlanVersionSummary = {
      id: "v-1",
      version_number: 1,
      created_at: "2025-03-09T12:00:00.000Z",
    };
    expect(summary.version_number).toBe(1);
    const withExecuted: PlanVersionSummary = { ...summary, is_executed_version: true };
    expect(withExecuted.is_executed_version).toBe(true);
  });

  it("PlanVersionContent has version_number, title, content, optional metadata, created_at, optional is_executed_version", () => {
    const content: PlanVersionContent = {
      version_number: 2,
      title: "My Plan",
      content: "# My Plan\n\nBody",
      created_at: "2025-03-09T12:00:00.000Z",
    };
    expect(content.version_number).toBe(2);
    expect(content.title).toBe("My Plan");
    const withMeta: PlanVersionContent = {
      ...content,
      metadata: {
        planId: "p1",
        epicId: "e1",
        shippedAt: null,
        complexity: "medium",
      },
      is_executed_version: true,
    };
    expect(withMeta.metadata?.planId).toBe("p1");
    expect(withMeta.is_executed_version).toBe(true);
  });

  it("Plan accepts optional currentVersionNumber and lastExecutedVersionNumber", () => {
    const planWithout: Plan = createPlan("p1", "planning");
    expect(planWithout.currentVersionNumber).toBeUndefined();
    expect(planWithout.lastExecutedVersionNumber).toBeUndefined();
    const planWith: Plan = {
      ...createPlan("p1", "building"),
      currentVersionNumber: 3,
      lastExecutedVersionNumber: 2,
    };
    expect(planWith.currentVersionNumber).toBe(3);
    expect(planWith.lastExecutedVersionNumber).toBe(2);
  });
});

describe("PlanMetadata", () => {
  it("accepts optional reviewedAt as null or ISO timestamp", () => {
    const without: PlanMetadata = {
      planId: "p1",
      epicId: "e1",
      shippedAt: null,
      complexity: "medium",
    };
    const withNull: PlanMetadata = { ...without, reviewedAt: null };
    const withTimestamp: PlanMetadata = { ...without, reviewedAt: "2025-03-09T12:00:00.000Z" };
    expect(without.reviewedAt).toBeUndefined();
    expect(withNull.reviewedAt).toBeNull();
    expect(withTimestamp.reviewedAt).toBe("2025-03-09T12:00:00.000Z");
  });

  it("accepts optional parentPlanId for sub-plan hierarchy", () => {
    const root: PlanMetadata = {
      planId: "root",
      epicId: "e-root",
      shippedAt: null,
      complexity: "high",
    };
    expect(root.parentPlanId).toBeUndefined();

    const child: PlanMetadata = { ...root, planId: "child", parentPlanId: "root" };
    expect(child.parentPlanId).toBe("root");
  });
});

describe("Plan hierarchy fields", () => {
  it("Plan accepts optional depth and childPlanIds", () => {
    const plan: Plan = {
      ...createPlan("p1", "planning"),
      depth: 0,
      childPlanIds: ["p1-child-1", "p1-child-2"],
    };
    expect(plan.depth).toBe(0);
    expect(plan.childPlanIds).toEqual(["p1-child-1", "p1-child-2"]);
  });

  it("Plan depth and childPlanIds are optional (backward compat)", () => {
    const plan: Plan = createPlan("p1", "building");
    expect(plan.depth).toBeUndefined();
    expect(plan.childPlanIds).toBeUndefined();
  });
});

describe("CreatePlanRequest.parentPlanId", () => {
  it("accepts optional parentPlanId", () => {
    const req: CreatePlanRequest = { title: "Sub-plan A", parentPlanId: "root-plan" };
    expect(req.parentPlanId).toBe("root-plan");
  });

  it("parentPlanId is optional (backward compat)", () => {
    const req: CreatePlanRequest = { title: "Root plan" };
    expect(req.parentPlanId).toBeUndefined();
  });
});

describe("PlanHierarchyNode / PlanHierarchyResponse", () => {
  it("PlanHierarchyNode represents a recursive tree", () => {
    const leaf: PlanHierarchyNode = {
      planId: "child-1",
      epicId: "e-child-1",
      parentPlanId: "root",
      depth: 1,
      status: "planning",
      taskCount: 5,
      children: [],
    };
    const root: PlanHierarchyNode = {
      planId: "root",
      epicId: "e-root",
      depth: 0,
      status: "building",
      taskCount: 10,
      children: [leaf],
    };
    expect(root.children).toHaveLength(1);
    expect(root.children[0].parentPlanId).toBe("root");
    expect(root.parentPlanId).toBeUndefined();
  });

  it("PlanHierarchyResponse wraps a root node", () => {
    const response: PlanHierarchyResponse = {
      root: {
        planId: "root",
        epicId: "e-root",
        depth: 0,
        status: "planning",
        taskCount: 0,
        children: [],
      },
    };
    expect(response.root.planId).toBe("root");
    expect(response.root.depth).toBe(0);
  });
});

describe("PLAN_STATUS_ORDER", () => {
  it("orders planning < building < in_review < complete", () => {
    expect(PLAN_STATUS_ORDER.planning).toBe(0);
    expect(PLAN_STATUS_ORDER.building).toBe(1);
    expect(PLAN_STATUS_ORDER.in_review).toBe(2);
    expect(PLAN_STATUS_ORDER.complete).toBe(3);
  });
});

describe("sortPlansByStatus", () => {
  it.each([
    {
      name: "orders planning before building before in_review before complete",
      input: [
        createPlan("plan-done", "complete"),
        createPlan("plan-planning", "planning"),
        createPlan("plan-in-review", "in_review"),
        createPlan("plan-building", "building"),
      ],
      expected: ["plan-planning", "plan-building", "plan-in-review", "plan-done"],
    },
    {
      name: "preserves relative order inside the same status bucket",
      input: [
        createPlan("plan-a", "building"),
        createPlan("plan-b", "building"),
        createPlan("plan-c", "planning"),
      ],
      expected: ["plan-c", "plan-a", "plan-b"],
    },
  ])("$name", ({ input, expected }) => {
    expect(sortPlansByStatus(input).map((plan) => plan.metadata.planId)).toEqual(expected);
  });

  it("returns a new array without mutating the input order", () => {
    const plans = [createPlan("plan-done", "complete"), createPlan("plan-planning", "planning")];

    const sorted = sortPlansByStatus(plans);

    expect(sorted).not.toBe(plans);
    expect(plans.map((plan) => plan.status)).toEqual(["complete", "planning"]);
  });

  it("handles an empty array", () => {
    expect(sortPlansByStatus([])).toEqual([]);
  });

  it("sends unknown statuses to the end via the fallback order", () => {
    const plans = [
      createPlan("plan-unknown", "planning" as never),
      createPlan("plan-planning", "planning"),
      { ...createPlan("plan-custom", "planning"), status: "custom" as never },
    ];

    expect(sortPlansByStatus(plans).map((plan) => plan.metadata.planId)).toEqual([
      "plan-unknown",
      "plan-planning",
      "plan-custom",
    ]);
  });

  it("falls back for unknown statuses on either side of the comparison", () => {
    const plans = [
      { ...createPlan("plan-custom-a", "planning"), status: "custom_a" as never },
      createPlan("plan-building", "building"),
      { ...createPlan("plan-custom-b", "planning"), status: "custom_b" as never },
    ];

    expect(sortPlansByStatus(plans).map((plan) => plan.metadata.planId)).toEqual([
      "plan-building",
      "plan-custom-a",
      "plan-custom-b",
    ]);
  });
});
