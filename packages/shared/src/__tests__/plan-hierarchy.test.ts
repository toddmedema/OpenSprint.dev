import { describe, it, expect } from "vitest";
import {
  MAX_PLAN_DEPTH,
  calculatePlanDepth,
  canCreateSubPlan,
  buildPlanTree,
} from "../plan-hierarchy.js";

describe("MAX_PLAN_DEPTH", () => {
  it("equals 4", () => {
    expect(MAX_PLAN_DEPTH).toBe(4);
  });
});

describe("calculatePlanDepth", () => {
  it("returns 1 for a root plan (no parent)", () => {
    const plans = new Map([["p1", {}]]);
    expect(calculatePlanDepth("p1", plans)).toBe(1);
  });

  it("returns 1 for a root plan with explicit undefined parentPlanId", () => {
    const plans = new Map([["p1", { parentPlanId: undefined }]]);
    expect(calculatePlanDepth("p1", plans)).toBe(1);
  });

  it("returns 2 for a direct child", () => {
    const plans = new Map<string, { parentPlanId?: string }>([
      ["root", {}],
      ["child", { parentPlanId: "root" }],
    ]);
    expect(calculatePlanDepth("child", plans)).toBe(2);
  });

  it("returns 3 for a grandchild", () => {
    const plans = new Map<string, { parentPlanId?: string }>([
      ["root", {}],
      ["child", { parentPlanId: "root" }],
      ["grandchild", { parentPlanId: "child" }],
    ]);
    expect(calculatePlanDepth("grandchild", plans)).toBe(3);
  });

  it("returns 4 for a great-grandchild", () => {
    const plans = new Map<string, { parentPlanId?: string }>([
      ["root", {}],
      ["d1", { parentPlanId: "root" }],
      ["d2", { parentPlanId: "d1" }],
      ["d3", { parentPlanId: "d2" }],
    ]);
    expect(calculatePlanDepth("d3", plans)).toBe(4);
  });

  it("throws on a direct self-cycle", () => {
    const plans = new Map([["p1", { parentPlanId: "p1" }]]);
    expect(() => calculatePlanDepth("p1", plans)).toThrow(/[Cc]ycle/);
  });

  it("throws on an indirect cycle", () => {
    const plans = new Map<string, { parentPlanId?: string }>([
      ["a", { parentPlanId: "c" }],
      ["b", { parentPlanId: "a" }],
      ["c", { parentPlanId: "b" }],
    ]);
    expect(() => calculatePlanDepth("a", plans)).toThrow(/[Cc]ycle/);
  });

  it("returns 1 when planId is not in the map", () => {
    const plans = new Map<string, { parentPlanId?: string }>();
    expect(calculatePlanDepth("missing", plans)).toBe(1);
  });
});

describe("canCreateSubPlan", () => {
  it("returns true for depth 1", () => {
    expect(canCreateSubPlan(1)).toBe(true);
  });

  it("returns true for depth 2", () => {
    expect(canCreateSubPlan(2)).toBe(true);
  });

  it("returns true for depth 3", () => {
    expect(canCreateSubPlan(3)).toBe(true);
  });

  it("returns false for depth 4 (MAX_PLAN_DEPTH)", () => {
    expect(canCreateSubPlan(4)).toBe(false);
  });

  it("returns false for depth 5", () => {
    expect(canCreateSubPlan(5)).toBe(false);
  });
});

describe("buildPlanTree", () => {
  it("returns empty map for empty input", () => {
    const tree = buildPlanTree([]);
    expect(tree.size).toBe(0);
  });

  it("groups root plans under empty string key", () => {
    const plans = [
      { planId: "a", parentPlanId: undefined },
      { planId: "b" },
    ];
    const tree = buildPlanTree(plans);
    expect(tree.get("")).toHaveLength(2);
    expect(tree.get("")!.map((p) => p.planId)).toEqual(["a", "b"]);
  });

  it("groups children under their parentPlanId", () => {
    const plans = [
      { planId: "root" },
      { planId: "c1", parentPlanId: "root" },
      { planId: "c2", parentPlanId: "root" },
      { planId: "gc1", parentPlanId: "c1" },
    ];
    const tree = buildPlanTree(plans);

    expect(tree.get("")!.map((p) => p.planId)).toEqual(["root"]);
    expect(tree.get("root")!.map((p) => p.planId)).toEqual(["c1", "c2"]);
    expect(tree.get("c1")!.map((p) => p.planId)).toEqual(["gc1"]);
    expect(tree.has("c2")).toBe(false);
  });

  it("preserves extra fields on plan objects", () => {
    const plans = [{ planId: "x", parentPlanId: undefined, title: "Root" }];
    const tree = buildPlanTree(plans);
    expect(tree.get("")![0]).toHaveProperty("title", "Root");
  });
});
