import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Plan } from "@opensprint/shared";
import { PlanCrudService, type PlanCrudStore } from "../services/plan-crud.service.js";
import { PlanDecomposeGenerateService } from "../services/plan-decompose-generate.service.js";
import { ProjectService } from "../services/project.service.js";
import { PrdService } from "../services/prd.service.js";
import type { NormalizedSubPlan } from "../services/plan/planner-normalize.js";

vi.mock("../websocket/index.js", () => ({
  broadcastToProject: vi.fn(),
}));

const { broadcastToProject } = await import("../websocket/index.js");

const PROJECT_ID = "proj-subplan-test";

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
    planListByParent: vi.fn(async (_projectId: string, parentPlanId: string) =>
      Array.from(plans.entries())
        .filter(([, row]) => row.parent_plan_id === parentPlanId)
        .map(([id]) => id)
    ),
    listAll: vi.fn(async () => []),
    show: vi.fn(async () => ({ id: "", title: "", status: "open", issue_type: "epic", type: "epic" }) as never),
    create: vi.fn(async () => {
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
    planUpdateMetadata: vi.fn(async (_projectId: string, planId: string, metadata: Record<string, unknown>) => {
      const row = plans.get(planId);
      if (row) row.metadata = metadata;
    }),
    planGetByEpicId: vi.fn(async () => null),
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

function createMockPrdService(): PrdService {
  return {
    getPrd: vi.fn(async () => ({ sections: [] })),
  } as unknown as PrdService;
}

async function callCreateSubPlans(
  svc: PlanDecomposeGenerateService,
  projectId: string,
  parent: Plan,
  subs: NormalizedSubPlan[]
): Promise<Plan[]> {
  return (
    svc as unknown as {
      createSubPlans: (p: string, parentPlan: Plan, sp: NormalizedSubPlan[]) => Promise<Plan[]>;
    }
  ).createSubPlans(projectId, parent, subs);
}

describe("PlanDecomposeGenerateService.createSubPlans", () => {
  let crud: PlanCrudService;
  let svc: PlanDecomposeGenerateService;
  let mockPlans: Map<string, MockPlanRow>;

  beforeEach(() => {
    vi.clearAllMocks();
    const { store, plans } = createMockTaskStore();
    mockPlans = plans;
    const projectService = createMockProjectService();
    crud = new PlanCrudService(store, projectService);
    svc = new PlanDecomposeGenerateService(
      {
        taskStore: {
          listAll: vi.fn(async () => []),
          createMany: vi.fn(),
          addDependencies: vi.fn(),
          addLabel: vi.fn(),
          close: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          planUpdateMetadata: vi.fn(),
        },
        projectService,
        prdService: createMockPrdService(),
        createPlan: (projectId, body) =>
          crud.createPlan(projectId, body as Parameters<PlanCrudService["createPlan"]>[1]),
        getPlan: (projectId, planId, opts) => crud.getPlan(projectId, planId, opts),
      },
      {}
    );
  });

  it("creates the expected number of children with parent linkage, distinct epics, and metadata depth", async () => {
    const parent = await crud.createPlan(PROJECT_ID, {
      title: "Root Feature",
      content: "# Root Feature\n\nOverview.",
      complexity: "high",
    });

    const subPlans: NormalizedSubPlan[] = [
      {
        title: "Stream A",
        overview: "First stream",
        content: "## Technical\n\nDetails A",
        dependsOnPlans: [],
      },
      {
        title: "Stream B",
        overview: "Second stream",
        content: "## Technical\n\nDetails B",
        dependsOnPlans: ["stream-a"],
      },
    ];

    const created = await callCreateSubPlans(svc, PROJECT_ID, parent, subPlans);
    expect(created).toHaveLength(2);
    expect(mockPlans.size).toBe(3);

    const childA = created[0]!;
    const childB = created[1]!;
    expect(childA.metadata.parentPlanId).toBe(parent.metadata.planId);
    expect(childB.metadata.parentPlanId).toBe(parent.metadata.planId);
    expect(childA.metadata.depth).toBe(2);
    expect(childB.metadata.depth).toBe(2);
    expect(childA.metadata.epicId).not.toBe(childB.metadata.epicId);

    const rowB = mockPlans.get(childB.metadata.planId);
    expect(rowB?.parent_plan_id).toBe(parent.metadata.planId);
    expect(rowB?.epic_id).toBe(childB.metadata.epicId);

    const loadedB = await crud.getPlan(PROJECT_ID, childB.metadata.planId);
    expect(loadedB.metadata.depth).toBe(2);
  });

  it("injects a Dependencies section for depends_on_plans between sub-plans", async () => {
    const parent = await crud.createPlan(PROJECT_ID, {
      title: "Root",
      content: "# Root\n\nText.",
    });

    const subPlans: NormalizedSubPlan[] = [
      {
        title: "Alpha",
        overview: "a",
        content: "## Scope\n\nalpha work",
        dependsOnPlans: [],
      },
      {
        title: "Beta",
        overview: "b",
        content: "## Scope\n\nbeta work",
        dependsOnPlans: ["alpha"],
      },
    ];

    const created = await callCreateSubPlans(svc, PROJECT_ID, parent, subPlans);
    const beta = created[1]!;
    expect(beta.content).toMatch(/## Dependencies/i);
    expect(beta.content).toContain("- alpha");
  });

  it("broadcasts plan.updated for each child and the parent", async () => {
    const parent = await crud.createPlan(PROJECT_ID, {
      title: "Root Broadcast",
      content: "# Root\n\n.",
    });
    const subPlans: NormalizedSubPlan[] = [
      { title: "C1", overview: "o", content: "## X\n\ny", dependsOnPlans: [] },
      { title: "C2", overview: "p", content: "## X\n\nz", dependsOnPlans: [] },
    ];
    await callCreateSubPlans(svc, PROJECT_ID, parent, subPlans);

    expect(broadcastToProject).toHaveBeenCalledTimes(3);
    expect(broadcastToProject).toHaveBeenNthCalledWith(1, PROJECT_ID, {
      type: "plan.updated",
      planId: "c1",
    });
    expect(broadcastToProject).toHaveBeenNthCalledWith(2, PROJECT_ID, {
      type: "plan.updated",
      planId: "c2",
    });
    expect(broadcastToProject).toHaveBeenNthCalledWith(3, PROJECT_ID, {
      type: "plan.updated",
      planId: parent.metadata.planId,
    });
  });

  it("returns an empty array when subPlans is empty", async () => {
    const parent = await crud.createPlan(PROJECT_ID, {
      title: "Lonely Root",
      content: "# Root\n\n.",
    });
    const created = await callCreateSubPlans(svc, PROJECT_ID, parent, []);
    expect(created).toEqual([]);
    expect(broadcastToProject).not.toHaveBeenCalled();
  });

  it("uses parent metadata depth + 1 when parent has persisted depth", async () => {
    await crud.createPlan(PROJECT_ID, {
      title: "Root D",
      content: "# R\n\n.",
      depth: 2,
    });
    const parent = await crud.getPlan(PROJECT_ID, "root-d");

    const subPlans: NormalizedSubPlan[] = [
      { title: "Deep Child", overview: "o", content: "## Work\n\nw", dependsOnPlans: [] },
    ];
    const created = await callCreateSubPlans(svc, PROJECT_ID, parent, subPlans);
    expect(created[0]!.metadata.depth).toBe(3);
  });
});
