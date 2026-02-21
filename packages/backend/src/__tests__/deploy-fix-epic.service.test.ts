import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createFixEpicFromTestOutput } from "../services/deploy-fix-epic.service.js";
import { ProjectService } from "../services/project.service.js";
import { BeadsService } from "../services/beads.service.js";
import { DEFAULT_HIL_CONFIG } from "@opensprint/shared";

const {
  mockInvoke,
  mockBeadsCreate,
  mockBeadsCreateWithRetry,
  mockBeadsUpdate,
  mockBeadsAddDependency,
  mockBeadsClose,
  mockBeadsReady,
  mockBeadsInit,
  mockBeadsConfigSet,
  mockBeadsListAll,
} = vi.hoisted(() => {
  const mockInvoke = vi.fn().mockResolvedValue({
    content: JSON.stringify({
      status: "success",
      tasks: [
        {
          index: 0,
          title: "Fix auth test",
          description: "Fix failing auth test",
          priority: 1,
          depends_on: [],
        },
        {
          index: 1,
          title: "Fix API test",
          description: "Fix API endpoint test",
          priority: 1,
          depends_on: [0],
        },
      ],
    }),
  });
  const mockBeadsCreate = vi.fn();
  const mockBeadsCreateWithRetry = vi.fn();
  const mockBeadsUpdate = vi.fn();
  const mockBeadsAddDependency = vi.fn();
  const mockBeadsClose = vi.fn();
  const mockBeadsReady = vi.fn();
  const mockBeadsInit = vi.fn().mockResolvedValue(undefined);
  const mockBeadsConfigSet = vi.fn().mockResolvedValue(undefined);
  const mockBeadsListAll = vi.fn().mockResolvedValue([]);
  return {
    mockInvoke,
    mockBeadsCreate,
    mockBeadsCreateWithRetry,
    mockBeadsUpdate,
    mockBeadsAddDependency,
    mockBeadsClose,
    mockBeadsReady,
    mockBeadsInit,
    mockBeadsConfigSet,
    mockBeadsListAll,
  };
});

vi.mock("../services/agent-client.js", () => ({
  AgentClient: vi.fn().mockImplementation(() => ({ invoke: mockInvoke })),
}));

vi.mock("../services/beads.service.js", () => ({
  BeadsService: vi.fn().mockImplementation(() => ({
    init: mockBeadsInit,
    configSet: mockBeadsConfigSet,
    listAll: mockBeadsListAll,
    create: mockBeadsCreate,
    createWithRetry: mockBeadsCreateWithRetry,
    update: mockBeadsUpdate,
    addDependency: mockBeadsAddDependency,
    close: mockBeadsClose,
    ready: mockBeadsReady,
  })),
}));

describe("deploy-fix-epic service", () => {
  let tempDir: string;
  let projectId: string;
  let projectService: ProjectService;
  let originalHome: string | undefined;

  afterEach(async () => {
    process.env.HOME = originalHome;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    mockBeadsCreate.mockClear();
    mockBeadsCreateWithRetry.mockClear();
    mockBeadsCreate.mockImplementation(
      (_repo: string, _title: string, opts?: { type?: string; parentId?: string }) => {
        const id = opts?.parentId
          ? `${opts.parentId}.${Math.floor(Math.random() * 1000)}`
          : `epic-${Date.now()}`;
        return Promise.resolve({ id });
      }
    );
    mockBeadsCreateWithRetry.mockImplementation(
      (_repo: string, _title: string, opts?: { type?: string; parentId?: string }) => {
        const id = opts?.parentId
          ? `${opts.parentId}.${Math.floor(Math.random() * 1000)}`
          : `epic-${Date.now()}`;
        return Promise.resolve({ id });
      }
    );
    mockBeadsUpdate.mockResolvedValue(undefined);
    mockBeadsAddDependency.mockResolvedValue(undefined);
    mockBeadsClose.mockResolvedValue(undefined);
    mockBeadsReady.mockResolvedValue([{ id: "fix-1", title: "Fix auth test", status: "ready" }]);

    mockInvoke.mockResolvedValue({
      content: JSON.stringify({
        status: "success",
        tasks: [
          {
            index: 0,
            title: "Fix auth test",
            description: "Fix failing auth test",
            priority: 1,
            depends_on: [],
          },
          {
            index: 1,
            title: "Fix API test",
            description: "Fix API endpoint test",
            priority: 1,
            depends_on: [0],
          },
        ],
      }),
    });
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "deploy-fix-epic-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
    projectService = new ProjectService();

    const repoPath = path.join(tempDir, "proj");
    await fs.mkdir(repoPath, { recursive: true });
    await fs.writeFile(
      path.join(repoPath, "package.json"),
      JSON.stringify({ name: "test", scripts: { test: "echo ok" } })
    );

    const project = await projectService.createProject({
      name: "Fix Epic Test",
      repoPath,
      planningAgent: { type: "custom", model: null, cliCommand: "echo" },
      codingAgent: { type: "custom", model: null, cliCommand: "echo" },
      deployment: { mode: "custom" },
      hilConfig: DEFAULT_HIL_CONFIG,
    });
    projectId = project.id;
  });

  it("returns null when agent returns failed status", async () => {
    mockInvoke.mockResolvedValueOnce({
      content: JSON.stringify({ status: "failed", tasks: [] }),
    });

    const project = await projectService.getProject(projectId);
    const result = await createFixEpicFromTestOutput(
      projectId,
      project.repoPath,
      "FAIL  src/auth.test.ts"
    );

    expect(result).toBeNull();
  });

  it("returns null when createWithRetry fails for gate task", async () => {
    mockBeadsCreateWithRetry.mockResolvedValueOnce(null);

    const project = await projectService.getProject(projectId);
    const result = await createFixEpicFromTestOutput(
      projectId,
      project.repoPath,
      "FAIL  src/auth.test.ts"
    );

    expect(result).toBeNull();
  });

  it("returns null when createWithRetry fails for a fix task", async () => {
    mockBeadsCreateWithRetry
      .mockResolvedValueOnce({ id: "gate-1" })
      .mockResolvedValueOnce({ id: "task-1" })
      .mockResolvedValueOnce(null);

    const project = await projectService.getProject(projectId);
    const result = await createFixEpicFromTestOutput(
      projectId,
      project.repoPath,
      "FAIL  src/auth.test.ts"
    );

    expect(result).toBeNull();
  });

  it("creates fix epic and tasks when agent returns valid tasks", async () => {
    const project = await projectService.getProject(projectId);
    const result = await createFixEpicFromTestOutput(
      projectId,
      project.repoPath,
      "FAIL  src/auth.test.ts\n  Expected: true\n  Received: false"
    );

    expect(result).not.toBeNull();
    expect(result!.epicId).toBeDefined();
    expect(result!.taskCount).toBe(2);
    expect(result!.gateTaskId).toBeDefined();

    expect(mockBeadsCreate).toHaveBeenCalledTimes(1);
    expect(mockBeadsCreate).toHaveBeenCalledWith(
      project.repoPath,
      "Fix: pre-deploy test failures",
      expect.objectContaining({ type: "epic" })
    );
    expect(mockBeadsCreateWithRetry).toHaveBeenCalledTimes(3);
    const createWithRetryCalls = mockBeadsCreateWithRetry.mock.calls;
    expect(createWithRetryCalls[0][1]).toBe("Plan approval gate");
    expect(createWithRetryCalls[0][2]).toMatchObject({ type: "task", parentId: expect.any(String) });
    expect(createWithRetryCalls[1][1]).toBe("Fix auth test");
    expect(createWithRetryCalls[2][1]).toBe("Fix API test");
    expect(mockBeadsClose).toHaveBeenCalled();
    const beads = new BeadsService();
    const ready = await beads.ready(project.repoPath);
    expect(ready.length).toBeGreaterThan(0);
  });
});
