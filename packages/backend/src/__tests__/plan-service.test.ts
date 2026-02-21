import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { PlanService } from "../services/plan.service.js";
import { ProjectService } from "../services/project.service.js";
import { DEFAULT_HIL_CONFIG, OPENSPRINT_PATHS } from "@opensprint/shared";

const mockBeadsCreate = vi.fn();
const mockBeadsCreateWithRetry = vi.fn();
const mockBeadsUpdate = vi.fn();
const mockBeadsAddDependency = vi.fn();
const mockBeadsAddLabel = vi.fn();
const mockBeadsListAll = vi.fn();

vi.mock("../services/beads.service.js", () => ({
  BeadsService: vi.fn().mockImplementation(() => ({
    create: (...args: unknown[]) => mockBeadsCreate(...args),
    createWithRetry: (...args: unknown[]) => mockBeadsCreateWithRetry(...args),
    update: (...args: unknown[]) => mockBeadsUpdate(...args),
    addDependency: (...args: unknown[]) => mockBeadsAddDependency(...args),
    addLabel: (...args: unknown[]) => mockBeadsAddLabel(...args),
    configSet: vi.fn().mockResolvedValue(undefined),
    listAll: (...args: unknown[]) => mockBeadsListAll(...args),
    show: vi.fn().mockResolvedValue({}),
    init: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockInvokePlanningAgent = vi.fn();
vi.mock("../services/agent.service.js", () => ({
  agentService: {
    invokePlanningAgent: (...args: unknown[]) => mockInvokePlanningAgent(...args),
  },
}));

vi.mock("../services/chat.service.js", () => ({
  ChatService: vi.fn().mockImplementation(() => ({
    syncPrdFromPlanShip: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../websocket/index.js", () => ({
  broadcastToProject: vi.fn(),
}));

describe("PlanService createWithRetry usage", () => {
  let planService: PlanService;
  let projectService: ProjectService;
  let tempDir: string;
  let projectId: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockInvokePlanningAgent.mockResolvedValue({ content: JSON.stringify({ complexity: "medium" }) });
    planService = new PlanService();
    projectService = new ProjectService();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opensprint-plan-service-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    const project = await projectService.createProject({
      name: "Plan Service Test",
      repoPath: path.join(tempDir, "test-project"),
      planningAgent: { type: "cursor", model: "claude-sonnet-4", cliCommand: null },
      codingAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
      deployment: { mode: "custom" },
      hilConfig: DEFAULT_HIL_CONFIG,
    });
    projectId = project.id;

    const repoPath = path.join(tempDir, "test-project");
    await fs.mkdir(path.join(repoPath, ".opensprint", "plans"), { recursive: true });

    // Epic create returns epic (no parentId) - use mockResolvedValue so it works across multiple tests
    mockBeadsCreate.mockResolvedValue({ id: "epic-123", title: "Test Plan", type: "epic" });
    // Gate create (parentId: epic-123) - default for tests without tasks
    mockBeadsCreateWithRetry.mockResolvedValue({ id: "epic-123.0", title: "Plan approval gate", type: "task" });
    mockBeadsListAll.mockResolvedValue([]);
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("createPlan uses beads.create for epic only (no parentId)", async () => {
    const plan = await planService.createPlan(projectId, {
      title: "Test Plan",
      content: "# Test Plan\n\n## Overview\n\nContent.",
      complexity: "low",
    });

    expect(plan.metadata.beadEpicId).toBe("epic-123");
    expect(plan.metadata.gateTaskId).toBe("epic-123.0");

    // Epic: beads.create (no parentId)
    expect(mockBeadsCreate).toHaveBeenCalledTimes(1);
    expect(mockBeadsCreate).toHaveBeenCalledWith(
      expect.any(String),
      "Test Plan",
      expect.objectContaining({ type: "epic" })
    );
    expect(mockBeadsCreate.mock.calls[0][2]).not.toHaveProperty("parentId");
  });

  it("createPlan uses createWithRetry for gate task (parentId)", async () => {
    await planService.createPlan(projectId, {
      title: "Test Plan",
      content: "# Test Plan\n\n## Overview\n\nContent.",
      complexity: "low",
    });

    // Gate: createWithRetry with parentId
    expect(mockBeadsCreateWithRetry).toHaveBeenCalledWith(
      expect.any(String),
      "Plan approval gate",
      expect.objectContaining({
        type: "task",
        parentId: "epic-123",
      })
    );
  });

  it("createPlan uses createWithRetry for child tasks (parentId)", async () => {
    mockBeadsCreateWithRetry
      .mockResolvedValueOnce({ id: "epic-123.0", title: "Plan approval gate", type: "task" })
      .mockResolvedValueOnce({ id: "epic-123.1", title: "Task A", type: "task" })
      .mockResolvedValueOnce({ id: "epic-123.2", title: "Task B", type: "task" });

    const plan = await planService.createPlan(projectId, {
      title: "Test Plan",
      content: "# Test Plan\n\n## Overview\n\nContent.",
      complexity: "low",
      tasks: [
        { title: "Task A", description: "First", priority: 0, dependsOn: [] },
        { title: "Task B", description: "Second", priority: 1, dependsOn: ["Task A"] },
      ],
    });

    expect(plan.taskCount).toBe(2);

    // Gate + 2 tasks = 3 createWithRetry calls
    expect(mockBeadsCreateWithRetry).toHaveBeenCalledTimes(3);

    // All createWithRetry calls must have parentId
    const createWithRetryCalls = mockBeadsCreateWithRetry.mock.calls;
    for (const call of createWithRetryCalls) {
      expect(call[2]).toHaveProperty("parentId", "epic-123");
    }

    // Child tasks use fallbackToStandalone
    const taskCalls = createWithRetryCalls.filter((c) => c[1] !== "Plan approval gate");
    expect(taskCalls.length).toBe(2);
    for (const call of taskCalls) {
      expect(call[3]).toEqual({ fallbackToStandalone: true });
    }
  });

  it("generateAndCreateTasks (via shipPlan) uses createWithRetry for generated tasks under epic", async () => {
    // Plan with no tasks: shipPlan will call generateAndCreateTasks
    mockInvokePlanningAgent.mockImplementation((opts: { tracking?: { label?: string } }) => {
      if (opts.tracking?.label === "Task generation") {
        return Promise.resolve({
          content: JSON.stringify({
            tasks: [
              { title: "Generated Task A", description: "First", priority: 1, dependsOn: [] },
              { title: "Generated Task B", description: "Second", priority: 2, dependsOn: ["Generated Task A"] },
            ],
          }),
        });
      }
      return Promise.resolve({ content: JSON.stringify({ complexity: "medium" }) });
    });
    mockBeadsCreateWithRetry
      .mockResolvedValueOnce({ id: "epic-123.0", title: "Plan approval gate", type: "task" })
      .mockResolvedValueOnce({ id: "epic-123.1", title: "Generated Task A", type: "task" })
      .mockResolvedValueOnce({ id: "epic-123.2", title: "Generated Task B", type: "task" });

    const plan = await planService.createPlan(projectId, {
      title: "Test Plan",
      content: "# Test Plan\n\n## Overview\n\nContent.",
      complexity: "low",
    });
    const planId = plan.metadata.planId;

    const result = await planService.shipPlan(projectId, planId);

    expect(result.status).toBe("building");

    // createWithRetry: 1 gate + 2 generated tasks = 3 calls, all with parentId
    const createWithRetryCalls = mockBeadsCreateWithRetry.mock.calls;
    expect(createWithRetryCalls.length).toBeGreaterThanOrEqual(3);
    const generatedTaskCalls = createWithRetryCalls.filter(
      (c) => c[1] !== "Plan approval gate" && c[1] !== "Re-execute approval gate"
    );
    expect(generatedTaskCalls.length).toBe(2);
    for (const call of generatedTaskCalls) {
      expect(call[2]).toHaveProperty("parentId", "epic-123");
      expect(call[3]).toEqual({ fallbackToStandalone: true });
    }
  });

  it("reshipPlan (re-execute path) uses createWithRetry for new gate and delta tasks", async () => {
    // Create plan with tasks
    mockInvokePlanningAgent.mockImplementation((opts: { tracking?: { label?: string } }) => {
      if (opts.tracking?.label === "Re-execute: audit & delta tasks") {
        return Promise.resolve({
          content: JSON.stringify({
            status: "success",
            capability_summary: "Existing features",
            tasks: [
              { index: 0, title: "Delta Task 1", description: "New work", priority: 1, depends_on: [] },
              { index: 1, title: "Delta Task 2", description: "More work", priority: 2, depends_on: [0] },
            ],
          }),
        });
      }
      return Promise.resolve({ content: JSON.stringify({ complexity: "medium" }) });
    });
    mockBeadsCreateWithRetry
      .mockResolvedValueOnce({ id: "epic-123.0", title: "Plan approval gate", type: "task" })
      .mockResolvedValueOnce({ id: "epic-123.1", title: "Task A", type: "task" })
      .mockResolvedValueOnce({ id: "epic-123.2", title: "Task B", type: "task" });

    const plan = await planService.createPlan(projectId, {
      title: "Reship Plan",
      content: "# Reship Plan\n\n## Overview\n\nContent.",
      complexity: "low",
      tasks: [
        { title: "Task A", description: "First", priority: 0, dependsOn: [] },
        { title: "Task B", description: "Second", priority: 1, dependsOn: ["Task A"] },
      ],
    });
    const planId = plan.metadata.planId;
    const repoPath = path.join(tempDir, "test-project");

    // Ship: close gate, set shippedAt. listAll must show tasks so taskCount > 0 (no generateAndCreateTasks)
    mockBeadsListAll.mockResolvedValue([
      { id: "epic-123", status: "open", type: "epic" },
      { id: "epic-123.0", status: "open", type: "task" },
      { id: "epic-123.1", status: "closed", type: "task" },
      { id: "epic-123.2", status: "closed", type: "task" },
    ]);
    await planService.shipPlan(projectId, planId);

    // Re-execute: listAll shows all tasks closed
    mockBeadsListAll.mockResolvedValue([
      { id: "epic-123", status: "open", type: "epic" },
      { id: "epic-123.0", status: "closed", type: "task" },
      { id: "epic-123.1", status: "closed", type: "task" },
      { id: "epic-123.2", status: "closed", type: "task" },
    ]);
    mockBeadsCreateWithRetry
      .mockResolvedValueOnce({ id: "epic-123.3", title: "Re-execute approval gate", type: "task" })
      .mockResolvedValueOnce({ id: "epic-123.4", title: "Delta Task 1", type: "task" })
      .mockResolvedValueOnce({ id: "epic-123.5", title: "Delta Task 2", type: "task" });

    await fs.writeFile(
      path.join(repoPath, OPENSPRINT_PATHS.plans, `${planId}.shipped.md`),
      "# Reship Plan\n\n## Overview\n\nContent.",
      "utf-8"
    );

    const beforeReshipCalls = mockBeadsCreateWithRetry.mock.calls.length;
    await planService.reshipPlan(projectId, planId);
    const afterReshipCalls = mockBeadsCreateWithRetry.mock.calls;

    const reshipCalls = afterReshipCalls.slice(beforeReshipCalls);
    expect(reshipCalls.length).toBe(3); // 1 new gate + 2 delta tasks

    const newGateCall = reshipCalls.find((c) => c[1] === "Re-execute approval gate");
    expect(newGateCall).toBeDefined();
    expect(newGateCall![2]).toHaveProperty("parentId", "epic-123");

    const deltaTaskCalls = reshipCalls.filter((c) => c[1] !== "Re-execute approval gate");
    expect(deltaTaskCalls.length).toBe(2);
    for (const call of deltaTaskCalls) {
      expect(call[2]).toHaveProperty("parentId", "epic-123");
      expect(call[3]).toEqual({ fallbackToStandalone: true });
    }
  });
});
