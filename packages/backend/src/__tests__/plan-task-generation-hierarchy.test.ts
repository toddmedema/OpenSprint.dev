import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatPlanTaskHierarchyContextForPrompt,
  generateAndCreateTasks,
} from "../services/plan/plan-task-generation.js";
import { agentService } from "../services/agent.service.js";
import type { Plan } from "@opensprint/shared";

vi.mock("../services/agent.service.js", () => ({
  agentService: {
    invokePlanningAgent: vi.fn(),
  },
}));

vi.mock("../services/plan/plan-repo-guard.js", () => ({
  runPlannerWithRepoGuard: vi.fn(async (opts: { run: () => Promise<unknown> }) => opts.run()),
}));

vi.mock("../services/agent-instructions.service.js", () => ({
  getCombinedInstructions: vi.fn().mockResolvedValue(""),
}));

vi.mock("../websocket/index.js", () => ({
  broadcastToProject: vi.fn(),
}));

describe("formatPlanTaskHierarchyContextForPrompt", () => {
  it("includes truncated ancestor titles and overviews in order", () => {
    const block = formatPlanTaskHierarchyContextForPrompt({
      ancestors: [
        { title: "Root Feature", overview: "Top-level scope for the product area." },
        { title: "Auth subtree", overview: "Login and sessions." },
      ],
      siblings: [],
    });
    expect(block).toContain("## Hierarchy: Ancestor chain");
    expect(block).toMatch(/### Root Feature[\s\S]*### Auth subtree/);
    expect(block).toContain("**Overview:**");
    expect(block).toContain("Top-level scope");
  });

  it("includes sibling task counts and scope from taskSummary", () => {
    const taskSummary =
      "## Plan: sibling-a (epic: os-e1)\n" +
      "- **os-e1.1**: Wire API\n" +
      "- **os-e1.2**: Add tests\n" +
      "";
    const block = formatPlanTaskHierarchyContextForPrompt({
      ancestors: [],
      siblings: [{ title: "Sibling A", taskSummary }],
    });
    expect(block).toContain("## Hierarchy: Sibling sub-plans");
    expect(block).toContain("**2** implementation tasks");
    expect(block).toContain("Wire API");
  });
});

describe("generateAndCreateTasks hierarchyContext", () => {
  beforeEach(() => {
    vi.mocked(agentService.invokePlanningAgent).mockResolvedValue({
      content: JSON.stringify({
        tasks: [{ title: "T1", description: "d", priority: 1, dependsOn: [] }],
      }),
    } as never);
  });

  it("prepends hierarchy block and omits legacy ancestor/sibling string sections", async () => {
    const plan: Plan = {
      metadata: {
        planId: "p1",
        epicId: "os-epic-1",
        shippedAt: null,
        complexity: "medium",
        parentPlanId: "parent-plan",
      },
      content: "# Child\n\nBody",
      status: "planning",
      taskCount: 0,
      doneTaskCount: 0,
      dependencyCount: 0,
      lastModified: "",
      currentVersionNumber: 1,
      hasGeneratedPlanTasksForCurrentVersion: false,
    };

    await generateAndCreateTasks({
      projectId: "proj",
      repoPath: "/tmp/r",
      plan,
      prdContext: "PRD here",
      hierarchyContext: {
        ancestors: [{ title: "Root", overview: "Root scope." }],
        siblings: [
          {
            title: "Other",
            taskSummary: "## Plan: other (epic: e)\n- **e.1**: Done\n",
          },
        ],
      },
      ancestorChainSummary: "SHOULD NOT APPEAR",
      siblingPlanSummaries: "NEITHER THIS",
      settings: {},
      taskStore: {
        createMany: vi.fn().mockResolvedValue([{ id: "os-epic-1.1" }]),
        addDependencies: vi.fn(),
        addLabel: vi.fn(),
      },
    });

    const call = vi.mocked(agentService.invokePlanningAgent).mock.calls[0]?.[0] as {
      messages?: Array<{ content?: string }>;
    };
    const content = call?.messages?.[0]?.content ?? "";
    expect(content).toContain("## Hierarchy: Ancestor chain");
    expect(content).toContain("## Hierarchy: Sibling sub-plans");
    expect(content).toContain("**1** implementation task");
    expect(content).not.toContain("SHOULD NOT APPEAR");
    expect(content).not.toContain("NEITHER THIS");
    expect(content).toMatch(/## Hierarchy:[\s\S]*Break down the following feature plan/);
  });

  it("resolves dependsOn to sibling epic task ids via crossEpicDependsTitleToId", async () => {
    vi.mocked(agentService.invokePlanningAgent).mockResolvedValue({
      content: JSON.stringify({
        tasks: [
          {
            title: "B depends on A",
            description: "d",
            priority: 1,
            dependsOn: ["Task from plan A"],
            complexity: 3,
            files: { modify: [], create: [], test: [] },
          },
        ],
      }),
    } as never);

    const plan: Plan = {
      metadata: {
        planId: "child-b",
        epicId: "os-epic-b",
        shippedAt: null,
        complexity: "medium",
        parentPlanId: "root-plan",
      },
      content: "# Child B\n\n## Dependencies\n\n- child-plan-a",
      status: "planning",
      taskCount: 0,
      doneTaskCount: 0,
      dependencyCount: 0,
      lastModified: "",
      currentVersionNumber: 1,
      hasGeneratedPlanTasksForCurrentVersion: false,
    };

    const addDependencies = vi.fn();
    await generateAndCreateTasks({
      projectId: "proj",
      repoPath: "/tmp/r",
      plan,
      prdContext: "PRD",
      settings: {},
      crossEpicDependsTitleToId: { "Task from plan A": "os-epic-a.1" },
      taskStore: {
        createMany: vi.fn().mockResolvedValue([{ id: "os-epic-b.1" }]),
        addDependencies,
        addLabel: vi.fn(),
      },
    });

    expect(addDependencies).toHaveBeenCalledWith("proj", [
      { childId: "os-epic-b.1", parentId: "os-epic-a.1", type: "blocks" },
    ]);
  });
});

describe("formatPlanTaskHierarchyContextForPrompt cross-epic hint", () => {
  it("mentions cross-epic dependsOn when siblings are present", () => {
    const block = formatPlanTaskHierarchyContextForPrompt({
      ancestors: [],
      siblings: [
        {
          title: "Sibling A",
          taskSummary: "## Plan: a (epic: e1)\n- **e1.1**: Do A\n",
        },
      ],
    });
    expect(block).toContain("Cross-epic dependencies");
    expect(block).toContain("dependsOn");
  });
});
