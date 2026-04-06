import { describe, it, expect, beforeEach, vi } from "vitest";
import { PlanCrudService, type PlanCrudStore } from "../services/plan-crud.service.js";
import { ProjectService } from "../services/project.service.js";

const PROJECT_ID = "test-project";

/**
 * In-memory plan store row: mirrors what the real store returns from planGet,
 * plus bookkeeping for insert/list/delete.
 */
interface MockPlanRow {
  content: string;
  metadata: Record<string, unknown>;
  shipped_content: string | null;
  updated_at: string;
  current_version_number: number;
  last_executed_version_number: number | null;
  parent_plan_id: string | null;
  epic_id: string;
}

function createMockTaskStore() {
  const plans = new Map<string, MockPlanRow>();
  let epicCounter = 0;

  const store: PlanCrudStore = {
    planGet: vi.fn(async (_projectId: string, planId: string) => {
      const row = plans.get(planId);
      if (!row) return null;
      return {
        content: row.content,
        metadata: row.metadata,
        shipped_content: row.shipped_content,
        updated_at: row.updated_at,
        current_version_number: row.current_version_number,
        last_executed_version_number: row.last_executed_version_number,
        parent_plan_id: row.parent_plan_id,
      };
    }),
    planListIds: vi.fn(async () => Array.from(plans.keys())),
    planListAllForProject: vi.fn(async () =>
      Array.from(plans.entries()).map(([planId, row]) => ({
        plan_id: planId,
        content: row.content,
        metadata: row.metadata,
        shipped_content: row.shipped_content,
        updated_at: row.updated_at,
        current_version_number: row.current_version_number,
        last_executed_version_number: row.last_executed_version_number,
        parent_plan_id: row.parent_plan_id,
      }))
    ),
    planListByParent: vi.fn(async (_projectId: string, parentPlanId: string) =>
      Array.from(plans.entries())
        .filter(([, row]) => row.parent_plan_id === parentPlanId)
        .map(([id]) => id)
    ),
    listAll: vi.fn(async () => []),
    show: vi.fn(async (_projectId: string, taskId: string) => {
      const epicRow = Array.from(plans.values()).find((r) => r.epic_id === taskId);
      return {
        id: taskId,
        title: taskId,
        status: epicRow ? "blocked" : "open",
        issue_type: "epic",
        type: "epic",
      } as never;
    }),
    create: vi.fn(async (_projectId: string, _title: string) => {
      epicCounter++;
      return { id: `os-epic-${epicCounter}` };
    }),
    createMany: vi.fn(async (_projectId: string, inputs: Array<{ title: string }>) =>
      inputs.map((_, i) => ({ id: `os-task-${epicCounter}-${i + 1}` }))
    ),
    update: vi.fn(async () => {}),
    addDependencies: vi.fn(async () => {}),
    addLabel: vi.fn(async () => {}),
    planInsert: vi.fn(
      async (
        _projectId: string,
        planId: string,
        data: { epic_id: string; content: string; metadata: string; parent_plan_id?: string | null }
      ) => {
        const metadata = JSON.parse(data.metadata) as Record<string, unknown>;
        plans.set(planId, {
          content: data.content,
          metadata,
          shipped_content: null,
          updated_at: new Date().toISOString(),
          current_version_number: 1,
          last_executed_version_number: null,
          parent_plan_id: data.parent_plan_id ?? null,
          epic_id: data.epic_id,
        });
      }
    ),
    planUpdateContent: vi.fn(async () => {}),
    planUpdateMetadata: vi.fn(
      async (_projectId: string, planId: string, metadata: Record<string, unknown>) => {
        const row = plans.get(planId);
        if (row) row.metadata = metadata;
      }
    ),
    planGetByEpicId: vi.fn(async (_projectId: string, epicId: string) => {
      for (const [planId, row] of plans) {
        if (row.epic_id === epicId) {
          return { plan_id: planId, metadata: row.metadata };
        }
      }
      return null;
    }),
    delete: vi.fn(async () => {}),
    closeMany: vi.fn(async () => {}),
    planDelete: vi.fn(async (_projectId: string, planId: string) => plans.delete(planId)),
    listPlanVersions: vi.fn(async () => []),
    planVersionInsert: vi.fn(async (data: Record<string, unknown>) => ({
      id: 1,
      project_id: data.project_id as string,
      plan_id: data.plan_id as string,
      version_number: data.version_number as number,
      title: (data.title as string) ?? null,
      content: data.content as string,
      metadata: (data.metadata as string) ?? null,
      created_at: new Date().toISOString(),
      is_executed_version: false,
    })),
    planVersionList: vi.fn(async () => []),
    planVersionGetByVersionNumber: vi.fn(async () => {
      throw new Error("Not implemented");
    }),
    planVersionUpdateContent: vi.fn(async () => {}),
    planVersionSetExecutedVersion: vi.fn(async () => {}),
    planUpdateVersionNumbers: vi.fn(async () => {}),
  };

  return { store, plans };
}

function createMockProjectService(): ProjectService {
  return {
    getProject: vi.fn(async () => ({ repoPath: "/tmp/test-repo" })),
  } as unknown as ProjectService;
}

describe("PlanCrudService — hierarchy features", () => {
  let service: PlanCrudService;
  let mockStore: ReturnType<typeof createMockTaskStore>;

  beforeEach(() => {
    mockStore = createMockTaskStore();
    service = new PlanCrudService(mockStore.store, createMockProjectService());
  });

  describe("createPlan with parentPlanId", () => {
    it("persists parentPlanId in metadata and parent_plan_id column", async () => {
      await service.createPlan(PROJECT_ID, {
        title: "Root Plan",
        content: "# Root\n\nRoot plan content.",
      });

      const child = await service.createPlan(PROJECT_ID, {
        title: "Child Plan",
        content: "# Child\n\nChild plan content.",
        parentPlanId: "root-plan",
      });

      expect(child.metadata.parentPlanId).toBe("root-plan");

      const insertCall = (mockStore.store.planInsert as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(insertCall[2].parent_plan_id).toBe("root-plan");

      const storedMetadata = JSON.parse(insertCall[2].metadata);
      expect(storedMetadata.parentPlanId).toBe("root-plan");
    });

    it("creates a root plan with no parentPlanId", async () => {
      const plan = await service.createPlan(PROJECT_ID, {
        title: "Root Plan",
        content: "# Root\n\nRoot plan content.",
      });

      expect(plan.metadata.parentPlanId).toBeUndefined();

      const insertCall = (mockStore.store.planInsert as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(insertCall[2].parent_plan_id).toBeNull();
    });

    it("sets child depth from parent chain and rejects a fifth level (depth 5)", async () => {
      const d1 = await service.createPlan(PROJECT_ID, {
        title: "L1 Depth",
        content: "# L1\n\n.",
      });
      const d2 = await service.createPlan(PROJECT_ID, {
        title: "L2 Depth",
        content: "# L2\n\n.",
        parentPlanId: d1.metadata.planId,
      });
      const d3 = await service.createPlan(PROJECT_ID, {
        title: "L3 Depth",
        content: "# L3\n\n.",
        parentPlanId: d2.metadata.planId,
      });
      const d4 = await service.createPlan(PROJECT_ID, {
        title: "L4 Depth",
        content: "# L4\n\n.",
        parentPlanId: d3.metadata.planId,
      });
      expect(d2.metadata.depth).toBe(2);
      expect(d3.metadata.depth).toBe(3);
      expect(d4.metadata.depth).toBe(4);

      await expect(
        service.createPlan(PROJECT_ID, {
          title: "L5 Depth",
          content: "# L5\n\n.",
          parentPlanId: d4.metadata.planId,
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "PLAN_DEPTH_EXCEEDED",
        message: "Cannot create sub-plans: maximum hierarchy depth of 4 reached",
      });
    });

    it("returns 404 when parentPlanId does not exist", async () => {
      await expect(
        service.createPlan(PROJECT_ID, {
          title: "Orphan",
          content: "# Orphan\n\n.",
          parentPlanId: "no-such-parent-plan",
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "PLAN_NOT_FOUND",
      });
    });
  });

  describe("getPlan includes parentPlanId from row", () => {
    it("returns parentPlanId from the DB column", async () => {
      mockStore.plans.set("child-plan", {
        content: "# Child",
        metadata: {
          planId: "child-plan",
          epicId: "os-epic-1",
          shippedAt: null,
          complexity: "medium",
        },
        shipped_content: null,
        updated_at: new Date().toISOString(),
        current_version_number: 1,
        last_executed_version_number: null,
        parent_plan_id: "root-plan",
        epic_id: "os-epic-1",
      });

      const plan = await service.getPlan(PROJECT_ID, "child-plan");
      expect(plan.metadata.parentPlanId).toBe("root-plan");
    });

    it("falls back to metadata.parentPlanId if column is null", async () => {
      mockStore.plans.set("child-plan", {
        content: "# Child",
        metadata: {
          planId: "child-plan",
          epicId: "os-epic-1",
          shippedAt: null,
          complexity: "medium",
          parentPlanId: "legacy-parent",
        },
        shipped_content: null,
        updated_at: new Date().toISOString(),
        current_version_number: 1,
        last_executed_version_number: null,
        parent_plan_id: null,
        epic_id: "os-epic-1",
      });

      const plan = await service.getPlan(PROJECT_ID, "child-plan");
      expect(plan.metadata.parentPlanId).toBe("legacy-parent");
    });
  });

  describe("listPlans includes depth and childPlanIds", () => {
    beforeEach(() => {
      mockStore.plans.set("root", {
        content: "# Root",
        metadata: { planId: "root", epicId: "os-e-1", shippedAt: null, complexity: "medium" },
        shipped_content: null,
        updated_at: new Date().toISOString(),
        current_version_number: 1,
        last_executed_version_number: null,
        parent_plan_id: null,
        epic_id: "os-e-1",
      });
      mockStore.plans.set("child-a", {
        content: "# Child A",
        metadata: { planId: "child-a", epicId: "os-e-2", shippedAt: null, complexity: "low" },
        shipped_content: null,
        updated_at: new Date().toISOString(),
        current_version_number: 1,
        last_executed_version_number: null,
        parent_plan_id: "root",
        epic_id: "os-e-2",
      });
      mockStore.plans.set("child-b", {
        content: "# Child B",
        metadata: { planId: "child-b", epicId: "os-e-3", shippedAt: null, complexity: "medium" },
        shipped_content: null,
        updated_at: new Date().toISOString(),
        current_version_number: 1,
        last_executed_version_number: null,
        parent_plan_id: "root",
        epic_id: "os-e-3",
      });
      mockStore.plans.set("grandchild", {
        content: "# Grandchild",
        metadata: { planId: "grandchild", epicId: "os-e-4", shippedAt: null, complexity: "low" },
        shipped_content: null,
        updated_at: new Date().toISOString(),
        current_version_number: 1,
        last_executed_version_number: null,
        parent_plan_id: "child-a",
        epic_id: "os-e-4",
      });
    });

    it("computes depth for each plan", async () => {
      const plans = await service.listPlans(PROJECT_ID);
      const byId = new Map(plans.map((p) => [p.metadata.planId, p]));

      expect(byId.get("root")!.depth).toBe(1);
      expect(byId.get("child-a")!.depth).toBe(2);
      expect(byId.get("child-b")!.depth).toBe(2);
      expect(byId.get("grandchild")!.depth).toBe(3);
    });

    it("computes childPlanIds for parent plans", async () => {
      const plans = await service.listPlans(PROJECT_ID);
      const byId = new Map(plans.map((p) => [p.metadata.planId, p]));

      expect(byId.get("root")!.childPlanIds).toEqual(
        expect.arrayContaining(["child-a", "child-b"])
      );
      expect(byId.get("child-a")!.childPlanIds).toEqual(["grandchild"]);
      expect(byId.get("child-b")!.childPlanIds).toBeUndefined();
      expect(byId.get("grandchild")!.childPlanIds).toBeUndefined();
    });
  });

  describe("getChildPlans", () => {
    it("returns child plans for a parent", async () => {
      mockStore.plans.set("parent", {
        content: "# Parent",
        metadata: { planId: "parent", epicId: "os-e-1", shippedAt: null, complexity: "medium" },
        shipped_content: null,
        updated_at: new Date().toISOString(),
        current_version_number: 1,
        last_executed_version_number: null,
        parent_plan_id: null,
        epic_id: "os-e-1",
      });
      mockStore.plans.set("c1", {
        content: "# C1",
        metadata: { planId: "c1", epicId: "os-e-2", shippedAt: null, complexity: "low" },
        shipped_content: null,
        updated_at: new Date().toISOString(),
        current_version_number: 1,
        last_executed_version_number: null,
        parent_plan_id: "parent",
        epic_id: "os-e-2",
      });
      mockStore.plans.set("c2", {
        content: "# C2",
        metadata: { planId: "c2", epicId: "os-e-3", shippedAt: null, complexity: "low" },
        shipped_content: null,
        updated_at: new Date().toISOString(),
        current_version_number: 1,
        last_executed_version_number: null,
        parent_plan_id: "parent",
        epic_id: "os-e-3",
      });

      const children = await service.getChildPlans(PROJECT_ID, "parent");
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.metadata.planId).sort()).toEqual(["c1", "c2"]);
    });

    it("returns empty array when no children exist", async () => {
      mockStore.plans.set("lonely", {
        content: "# Lonely",
        metadata: { planId: "lonely", epicId: "os-e-1", shippedAt: null, complexity: "medium" },
        shipped_content: null,
        updated_at: new Date().toISOString(),
        current_version_number: 1,
        last_executed_version_number: null,
        parent_plan_id: null,
        epic_id: "os-e-1",
      });

      const children = await service.getChildPlans(PROJECT_ID, "lonely");
      expect(children).toHaveLength(0);
    });
  });

  describe("getPlanHierarchy", () => {
    beforeEach(() => {
      mockStore.plans.set("root", {
        content: "# Root",
        metadata: { planId: "root", epicId: "os-e-1", shippedAt: null, complexity: "medium" },
        shipped_content: null,
        updated_at: new Date().toISOString(),
        current_version_number: 1,
        last_executed_version_number: null,
        parent_plan_id: null,
        epic_id: "os-e-1",
      });
      mockStore.plans.set("child-a", {
        content: "# Child A",
        metadata: { planId: "child-a", epicId: "os-e-2", shippedAt: null, complexity: "low" },
        shipped_content: null,
        updated_at: new Date().toISOString(),
        current_version_number: 1,
        last_executed_version_number: null,
        parent_plan_id: "root",
        epic_id: "os-e-2",
      });
      mockStore.plans.set("grandchild", {
        content: "# Grandchild",
        metadata: { planId: "grandchild", epicId: "os-e-3", shippedAt: null, complexity: "low" },
        shipped_content: null,
        updated_at: new Date().toISOString(),
        current_version_number: 1,
        last_executed_version_number: null,
        parent_plan_id: "child-a",
        epic_id: "os-e-3",
      });
    });

    it("builds recursive hierarchy tree", async () => {
      const hierarchy = await service.getPlanHierarchy(PROJECT_ID, "root");

      expect(hierarchy.planId).toBe("root");
      expect(hierarchy.depth).toBe(1);
      expect(hierarchy.children).toHaveLength(1);

      const childA = hierarchy.children[0];
      expect(childA.planId).toBe("child-a");
      expect(childA.depth).toBe(2);
      expect(childA.parentPlanId).toBe("root");
      expect(childA.children).toHaveLength(1);

      const grandchild = childA.children[0];
      expect(grandchild.planId).toBe("grandchild");
      expect(grandchild.depth).toBe(3);
      expect(grandchild.parentPlanId).toBe("child-a");
      expect(grandchild.children).toHaveLength(0);
    });

    it("returns a leaf node with no children", async () => {
      const hierarchy = await service.getPlanHierarchy(PROJECT_ID, "grandchild");

      expect(hierarchy.planId).toBe("grandchild");
      expect(hierarchy.children).toHaveLength(0);
    });

    it("includes epicId and status on each node", async () => {
      const hierarchy = await service.getPlanHierarchy(PROJECT_ID, "root");

      expect(hierarchy.epicId).toBe("os-e-1");
      expect(hierarchy.status).toBe("planning");
    });
  });
});
