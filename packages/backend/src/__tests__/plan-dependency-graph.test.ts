import { describe, it, expect } from "vitest";
import {
  buildDependencyEdgesCore,
  type PlanInfo,
} from "../services/plan/plan-dependency-graph.js";
import type { StoredTask } from "../services/task-store.service.js";

function makePlanInfo(planId: string, epicId: string, content = ""): PlanInfo {
  return { planId, epicId, content };
}

describe("buildDependencyEdgesCore", () => {
  describe("task-store blocker edges", () => {
    it("creates cross-plan edge when task in one epic blocks task in another", () => {
      const plans: PlanInfo[] = [
        makePlanInfo("plan-a", "epic-a"),
        makePlanInfo("plan-b", "epic-b"),
      ];
      const issues: StoredTask[] = [
        {
          id: "epic-b.1",
          title: "Task B1",
          status: "open",
          dependencies: [{ depends_on_id: "epic-a.1", type: "blocks" }],
        } as unknown as StoredTask,
      ];

      const edges = buildDependencyEdgesCore(plans, issues);
      expect(edges).toEqual([{ from: "plan-a", to: "plan-b", type: "blocks" }]);
    });

    it("skips self-loop when blocker is within the same epic", () => {
      const plans: PlanInfo[] = [makePlanInfo("plan-a", "epic-a")];
      const issues: StoredTask[] = [
        {
          id: "epic-a.2",
          title: "Task A2",
          status: "open",
          dependencies: [{ depends_on_id: "epic-a.1", type: "blocks" }],
        } as unknown as StoredTask,
      ];

      const edges = buildDependencyEdgesCore(plans, issues);
      expect(edges).toHaveLength(0);
    });

    it("deduplicates edges when multiple tasks create the same cross-plan edge", () => {
      const plans: PlanInfo[] = [
        makePlanInfo("plan-a", "epic-a"),
        makePlanInfo("plan-b", "epic-b"),
      ];
      const issues: StoredTask[] = [
        {
          id: "epic-b.1",
          title: "Task B1",
          status: "open",
          dependencies: [{ depends_on_id: "epic-a.1", type: "blocks" }],
        } as unknown as StoredTask,
        {
          id: "epic-b.2",
          title: "Task B2",
          status: "open",
          dependencies: [{ depends_on_id: "epic-a.2", type: "blocks" }],
        } as unknown as StoredTask,
      ];

      const edges = buildDependencyEdgesCore(plans, issues);
      expect(edges).toHaveLength(1);
      expect(edges[0]).toEqual({ from: "plan-a", to: "plan-b", type: "blocks" });
    });
  });

  describe("markdown Dependencies section edges", () => {
    it("creates edge when plan mentions another plan in Dependencies section", () => {
      const plans: PlanInfo[] = [
        makePlanInfo("auth-setup", "epic-a", "# Auth\n\n## Dependencies\n\nDepends on db-setup."),
        makePlanInfo("db-setup", "epic-b", "# DB\n\nNo deps."),
      ];

      const edges = buildDependencyEdgesCore(plans, []);
      expect(edges).toEqual([{ from: "db-setup", to: "auth-setup", type: "blocks" }]);
    });

    it("creates edges for multiple dependencies mentioned in markdown", () => {
      const plans: PlanInfo[] = [
        makePlanInfo("ui-layer", "epic-c", "# UI\n\n## Dependencies\n\nNeeds auth-setup and db-setup."),
        makePlanInfo("auth-setup", "epic-a", "# Auth\n\nStandalone."),
        makePlanInfo("db-setup", "epic-b", "# DB\n\nStandalone."),
      ];

      const edges = buildDependencyEdgesCore(plans, []);
      expect(edges).toHaveLength(2);
      const froms = edges.map((e) => e.from).sort();
      expect(froms).toEqual(["auth-setup", "db-setup"]);
      expect(edges.every((e) => e.to === "ui-layer")).toBe(true);
    });

    it("handles slug matching with hyphens and spaces", () => {
      // Consumer markdown references api-layer; hyphenated slugs map to the same plan id.
      const edges = buildDependencyEdgesCore(
        [
          makePlanInfo("consumer", "epic-b", "# Consumer\n\n## Dependencies\n\nUses api-layer."),
          makePlanInfo("api-layer", "epic-a", "# API\n\nProvider."),
        ],
        []
      );
      expect(edges).toEqual([{ from: "api-layer", to: "consumer", type: "blocks" }]);
    });
  });

  describe("combined task-store + markdown edges", () => {
    it("merges edges from both sources without duplicates", () => {
      const plans: PlanInfo[] = [
        makePlanInfo("plan-a", "epic-a", "# A\n\nNo deps."),
        makePlanInfo("plan-b", "epic-b", "# B\n\n## Dependencies\n\nDepends on plan-a."),
      ];
      const issues: StoredTask[] = [
        {
          id: "epic-b.1",
          title: "Task B1",
          status: "open",
          dependencies: [{ depends_on_id: "epic-a.1", type: "blocks" }],
        } as unknown as StoredTask,
      ];

      const edges = buildDependencyEdgesCore(plans, issues);
      expect(edges).toHaveLength(1);
      expect(edges[0]).toEqual({ from: "plan-a", to: "plan-b", type: "blocks" });
    });
  });

  describe("edge cases", () => {
    it("returns empty array for empty inputs", () => {
      expect(buildDependencyEdgesCore([], [])).toEqual([]);
    });

    it("returns empty array when no dependencies exist", () => {
      const plans: PlanInfo[] = [
        makePlanInfo("plan-a", "epic-a", "# A\n\nContent."),
        makePlanInfo("plan-b", "epic-b", "# B\n\nContent."),
      ];
      const issues: StoredTask[] = [
        { id: "epic-a.1", title: "T", status: "open", dependencies: [] } as unknown as StoredTask,
      ];
      expect(buildDependencyEdgesCore(plans, issues)).toEqual([]);
    });

    it("ignores tasks whose epic is not mapped to any plan", () => {
      const plans: PlanInfo[] = [makePlanInfo("plan-a", "epic-a")];
      const issues: StoredTask[] = [
        {
          id: "epic-unknown.1",
          title: "Orphan",
          status: "open",
          dependencies: [{ depends_on_id: "epic-a.1", type: "blocks" }],
        } as unknown as StoredTask,
      ];
      expect(buildDependencyEdgesCore(plans, issues)).toEqual([]);
    });

    it("does not detect cycles (documents known gap per SPEC)", () => {
      // SPEC requires DAG validation; current implementation does not reject cycles.
      // This test documents the gap: A→B and B→A both produce edges without rejection.
      const plans: PlanInfo[] = [
        makePlanInfo("plan-a", "epic-a", "# A\n\n## Dependencies\n\nNeeds plan-b."),
        makePlanInfo("plan-b", "epic-b", "# B\n\n## Dependencies\n\nNeeds plan-a."),
      ];

      const edges = buildDependencyEdgesCore(plans, []);
      expect(edges).toHaveLength(2);
      const sorted = edges.map((e) => `${e.from}->${e.to}`).sort();
      expect(sorted).toEqual(["plan-a->plan-b", "plan-b->plan-a"]);
    });
  });
});
