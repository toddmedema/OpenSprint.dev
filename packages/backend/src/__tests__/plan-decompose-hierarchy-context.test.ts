import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Plan } from "@opensprint/shared";
import { PlanDecomposeGenerateService } from "../services/plan-decompose-generate.service.js";
import { ProjectService } from "../services/project.service.js";
import { PrdService } from "../services/prd.service.js";
import type { StoredTask } from "../services/task-store.types.js";
import { buildPlanTaskSummaryFromCreated } from "../services/plan/plan-decompose-generate.js";

const mockGenerateAndCreateTasks = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ count: 1, taskRefs: [{ id: "os-e3.1", title: "Generated" }] })
);

vi.mock("../services/plan/plan-task-generation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/plan/plan-task-generation.js")>();
  return { ...actual, generateAndCreateTasks: mockGenerateAndCreateTasks };
});

vi.mock("../websocket/index.js", () => ({
  broadcastToProject: vi.fn(),
}));

describe("PlanDecomposeGenerateService.generateAndCreateTasks hierarchy wiring", () => {
  const projectId = "proj-hier";
  const repoPath = "/tmp/repo-hier";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateAndCreateTasks.mockResolvedValue({
      count: 1,
      taskRefs: [{ id: "os-e3.1", title: "Generated" }],
    });
  });

  it("passes hierarchyContext built from ancestors and sibling task summaries (buildPlanTaskSummaryFromCreated)", async () => {
    const rootPlan: Plan = {
      metadata: {
        planId: "root-plan",
        epicId: "os-epic-root",
        shippedAt: null,
        complexity: "medium",
        parentPlanId: undefined,
      },
      content: "# Root Title\n\n## Overview\nRoot overview line.\n\n## Technical Approach\nRoot tech.",
      status: "planning",
      taskCount: 0,
      doneTaskCount: 0,
      dependencyCount: 0,
      lastModified: "",
      currentVersionNumber: 1,
      hasGeneratedPlanTasksForCurrentVersion: false,
      depth: 1,
      parentPlanId: null,
    };

    const siblingEpicId = "os-epic-2";
    const siblingPlan: Plan = {
      metadata: {
        planId: "alpha-sibling",
        epicId: siblingEpicId,
        shippedAt: null,
        complexity: "medium",
        parentPlanId: "root-plan",
      },
      content: "# Alpha Sibling\n\n## Overview\nSibling overview here.\n",
      status: "planning",
      taskCount: 1,
      doneTaskCount: 0,
      dependencyCount: 0,
      lastModified: "",
      currentVersionNumber: 1,
      hasGeneratedPlanTasksForCurrentVersion: true,
      depth: 2,
      parentPlanId: "root-plan",
    };

    const targetPlan: Plan = {
      metadata: {
        planId: "zzz-child",
        epicId: "os-epic-3",
        shippedAt: null,
        complexity: "medium",
        parentPlanId: "root-plan",
      },
      content: "# Zzz Child\n\n## Overview\nChild scope.\n",
      status: "planning",
      taskCount: 0,
      doneTaskCount: 0,
      dependencyCount: 0,
      lastModified: "",
      currentVersionNumber: 1,
      hasGeneratedPlanTasksForCurrentVersion: false,
      depth: 2,
      parentPlanId: "root-plan",
    };

    const listAllIssues: StoredTask[] = [
      {
        id: `${siblingEpicId}.1`,
        title: "Sibling implementation task",
        status: "open",
        issue_type: "task",
        type: "task",
        sourcePlanVersionNumber: 1,
      } as StoredTask,
    ];

    const expectedSiblingSummary = buildPlanTaskSummaryFromCreated([
      {
        ...siblingPlan,
        _createdTaskIds: [`${siblingEpicId}.1`],
        _createdTaskTitles: ["Sibling implementation task"],
      },
    ]);

    const getPlan = vi.fn(async (_pid: string, id: string) => {
      if (id === "root-plan") return rootPlan;
      if (id === "alpha-sibling") return siblingPlan;
      if (id === "zzz-child") return targetPlan;
      throw new Error(`unexpected plan ${id}`);
    });

    const svc = new PlanDecomposeGenerateService(
      {
        taskStore: {
          listAll: vi.fn(async () => listAllIssues),
          createMany: vi.fn(),
          addDependencies: vi.fn(),
          addLabel: vi.fn(),
          close: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          planUpdateMetadata: vi.fn(),
          planListByParent: vi.fn(async () => ["alpha-sibling", "zzz-child"]),
        },
        projectService: {
          getProject: vi.fn(async () => ({ repoPath })),
          getSettings: vi.fn(async () => ({})),
        } as unknown as ProjectService,
        prdService: {
          getPrd: vi.fn(async () => ({ sections: {} })),
        } as unknown as PrdService,
        createPlan: vi.fn(),
        getPlan,
        ensurePlanHasAtLeastOneVersion: vi.fn(),
      },
      {}
    );

    await svc.generateAndCreateTasks(projectId, repoPath, targetPlan);

    expect(mockGenerateAndCreateTasks).toHaveBeenCalledTimes(1);
    const passed = mockGenerateAndCreateTasks.mock.calls[0]![0] as {
      hierarchyContext?: {
        ancestors: Array<{ title: string; overview: string }>;
        siblings: Array<{ title: string; taskSummary: string }>;
      };
      ancestorChainSummary?: string;
      siblingPlanSummaries?: string;
    };

    expect(passed.hierarchyContext).toBeDefined();
    expect(passed.hierarchyContext!.ancestors).toEqual([
      { title: "Root Title", overview: "Root overview line." },
    ]);
    expect(passed.hierarchyContext!.siblings).toHaveLength(1);
    expect(passed.hierarchyContext!.siblings[0]!.title).toBe("Alpha Sibling");
    expect(passed.hierarchyContext!.siblings[0]!.taskSummary.trim()).toBe(expectedSiblingSummary.trim());

    expect(passed.ancestorChainSummary).toBeUndefined();
    expect(passed.siblingPlanSummaries).toBeUndefined();
  });
});
