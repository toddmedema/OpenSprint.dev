import { describe, it, expect, beforeEach, vi } from "vitest";
import { TaskService } from "../services/task.service.js";
import { beadsCache } from "../services/beads-cache.js";
import { SessionManager } from "../services/session-manager.js";
import type { BeadsIssue } from "../services/beads.service.js";

vi.mock("../services/project.service.js", () => ({
  ProjectService: vi.fn().mockImplementation(() => ({
    getProject: vi.fn().mockResolvedValue({
      id: "proj-1",
      repoPath: "/tmp/test-repo",
    }),
  })),
}));

const defaultIssues: BeadsIssue[] = [
  {
    id: "task-1",
    title: "Test Task",
    description: "Test description",
    issue_type: "task",
    status: "open",
    priority: 1,
    assignee: null,
    labels: [],
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    dependencies: [],
  } as BeadsIssue,
];

let jsonlReadCalls: number;
let mockJsonlIssues: BeadsIssue[];

vi.mock("../services/jsonl-reader.js", () => ({
  readAllIssuesFromJsonl: vi.fn(async () => {
    jsonlReadCalls++;
    return mockJsonlIssues;
  }),
  readIssueFromJsonl: vi.fn(async (_repoPath: string, id: string) => {
    jsonlReadCalls++;
    return mockJsonlIssues.find((i) => i.id === id);
  }),
  invalidateJsonlCache: vi.fn(),
  clearJsonlCache: vi.fn(),
}));

describe("TaskService", () => {
  let taskService: TaskService;
  let beadsReadyCalls: number;

  beforeEach(async () => {
    beadsCache.clear();
    jsonlReadCalls = 0;
    mockJsonlIssues = [...defaultIssues];
    beadsReadyCalls = 0;

    const { BeadsService } = await import("../services/beads.service.js");
    vi.spyOn(BeadsService.prototype, "show").mockImplementation(
      async (_repoPath: string, id: string) => {
        const found = defaultIssues.find((i) => i.id === id);
        if (!found) throw new Error(`Issue ${id} not found`);
        return found;
      }
    );
    vi.spyOn(BeadsService.prototype, "listAll").mockImplementation(async () => {
      return defaultIssues;
    });
    vi.spyOn(BeadsService.prototype, "ready").mockImplementation(async () => {
      beadsReadyCalls++;
      return [];
    });

    taskService = new TaskService();
  });

  it("getTask reads from JSONL (bypasses bd CLI)", async () => {
    const task = await taskService.getTask("proj-1", "task-1");
    expect(task).toBeDefined();
    expect(task.id).toBe("task-1");
    expect(task.title).toBe("Test Task");
    expect(beadsReadyCalls).toBe(0);
    expect(jsonlReadCalls).toBeGreaterThan(0);
  });

  it("getTask throws 404 for unknown task ID", async () => {
    await expect(taskService.getTask("proj-1", "nonexistent")).rejects.toThrow("not found");
  });

  it("getTask does not call beads.ready (avoids N bd show calls)", async () => {
    await taskService.getTask("proj-1", "task-1");
    expect(beadsReadyCalls).toBe(0);
  });

  it("listTasks reads from JSONL (bypasses bd CLI)", async () => {
    const tasks = await taskService.listTasks("proj-1");
    expect(tasks).toBeDefined();
    expect(tasks.length).toBe(1);
    expect(jsonlReadCalls).toBeGreaterThan(0);
    expect(beadsReadyCalls).toBe(0);
  });

  it("listTasks does not call beads.ready (computes ready from JSONL)", async () => {
    await taskService.listTasks("proj-1");
    expect(beadsReadyCalls).toBe(0);
  });

  it("getReadyTasks does not call beads.ready (computes ready from JSONL)", async () => {
    const tasks = await taskService.getReadyTasks("proj-1");
    expect(tasks).toBeDefined();
    expect(beadsReadyCalls).toBe(0);
  });

  it("listTasks computes ready status from JSONL: task with no blockers is ready", async () => {
    mockJsonlIssues = [
      {
        id: "task-a",
        title: "Task A",
        status: "open",
        issue_type: "task",
        dependencies: [],
      },
    ] as BeadsIssue[];

    const tasks = await taskService.listTasks("proj-1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].kanbanColumn).toBe("ready");
  });

  it("listTasks computes ready status: task with open blocker is backlog", async () => {
    mockJsonlIssues = [
      { id: "blocker-1", status: "open", issue_type: "task", dependencies: [] },
      {
        id: "task-a",
        title: "Task A",
        status: "open",
        issue_type: "task",
        dependencies: [{ type: "blocks", depends_on_id: "blocker-1" }],
      },
    ] as BeadsIssue[];

    const tasks = await taskService.listTasks("proj-1");
    const taskA = tasks.find((t) => t.id === "task-a");
    expect(taskA).toBeDefined();
    expect(taskA!.kanbanColumn).toBe("backlog");
  });

  it("listTasks computes ready status: task with closed blocker is ready", async () => {
    mockJsonlIssues = [
      { id: "blocker-1", status: "closed", issue_type: "task", dependencies: [] },
      {
        id: "task-a",
        title: "Task A",
        status: "open",
        issue_type: "task",
        dependencies: [{ type: "blocks", depends_on_id: "blocker-1" }],
      },
    ] as BeadsIssue[];

    const tasks = await taskService.listTasks("proj-1");
    const taskA = tasks.find((t) => t.id === "task-a");
    expect(taskA).toBeDefined();
    expect(taskA!.kanbanColumn).toBe("ready");
  });

  it("listTasks excludes epics from ready (epics are containers, not work items)", async () => {
    mockJsonlIssues = [
      { id: "epic-1", status: "open", issue_type: "epic", dependencies: [] },
    ] as BeadsIssue[];

    const tasks = await taskService.listTasks("proj-1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].kanbanColumn).not.toBe("ready");
  });

  it("getReadyTasks returns only ready tasks (excludes tasks with open blockers)", async () => {
    mockJsonlIssues = [
      { id: "blocker-1", status: "closed", issue_type: "task", dependencies: [] },
      {
        id: "task-ready",
        title: "Ready Task",
        status: "open",
        issue_type: "task",
        dependencies: [{ type: "blocks", depends_on_id: "blocker-1" }],
      },
      { id: "blocker-2", status: "open", issue_type: "task", dependencies: [] },
      {
        id: "task-not-ready",
        title: "Not Ready",
        status: "open",
        issue_type: "task",
        dependencies: [{ type: "blocks", depends_on_id: "blocker-2" }],
      },
    ] as BeadsIssue[];

    const tasks = await taskService.getReadyTasks("proj-1");
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain("task-ready");
    expect(ids).toContain("blocker-2");
    expect(ids).not.toContain("task-not-ready");
    expect(ids).not.toContain("blocker-1");
  });

  it("listTasks calls loadSessionsGroupedByTaskId once (batch enrich, not N listSessions)", async () => {
    mockJsonlIssues = Array.from({ length: 10 }, (_, i) => ({
      id: `task-${i}`,
      title: `Task ${i}`,
      status: "open" as const,
      issue_type: "task" as const,
      dependencies: [],
    })) as BeadsIssue[];

    const loadSpy = vi.spyOn(SessionManager.prototype, "loadSessionsGroupedByTaskId");
    const listSpy = vi.spyOn(SessionManager.prototype, "listSessions");

    await taskService.listTasks("proj-1");

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).not.toHaveBeenCalled();

    loadSpy.mockRestore();
    listSpy.mockRestore();
  });

  it("listTasks enriches tasks with testResults from latest session", async () => {
    mockJsonlIssues = [
      {
        id: "task-with-session",
        title: "Task A",
        status: "open",
        issue_type: "task",
        dependencies: [],
      },
      {
        id: "task-no-session",
        title: "Task B",
        status: "open",
        issue_type: "task",
        dependencies: [],
      },
    ] as BeadsIssue[];

    const loadSpy = vi
      .spyOn(SessionManager.prototype, "loadSessionsGroupedByTaskId")
      .mockResolvedValue(
        new Map([
          [
            "task-with-session",
            [
              {
                taskId: "task-with-session",
                attempt: 1,
                agentType: "cursor" as const,
                agentModel: "gpt-4",
                startedAt: "2024-01-01T00:00:00Z",
                completedAt: null,
                status: "success" as const,
                outputLog: "",
                gitBranch: "main",
                gitDiff: null,
                testResults: { passed: 5, failed: 0, skipped: 1, total: 6, details: [] },
                failureReason: null,
              },
            ],
          ],
        ])
      );

    const tasks = await taskService.listTasks("proj-1");

    expect(tasks.find((t) => t.id === "task-with-session")?.testResults).toEqual({
      passed: 5,
      failed: 0,
      skipped: 1,
      total: 6,
      details: [],
    });
    expect(tasks.find((t) => t.id === "task-no-session")?.testResults).toBeUndefined();

    loadSpy.mockRestore();
  });

  it("listTasks cache is invalidated on markDone (mutations refresh cache)", async () => {
    const { BeadsService } = await import("../services/beads.service.js");
    vi.spyOn(BeadsService.prototype, "close").mockResolvedValue(undefined as never);
    vi.spyOn(BeadsService.prototype, "sync").mockResolvedValue(undefined as never);

    await taskService.listTasks("proj-1");
    const callsAfterFirst = jsonlReadCalls;

    await taskService.markDone("proj-1", "task-1");

    await taskService.listTasks("proj-1");
    expect(jsonlReadCalls).toBeGreaterThan(callsAfterFirst);
  });

  it("listTasks cache is invalidated on unblock (update mutation)", async () => {
    const { BeadsService } = await import("../services/beads.service.js");
    vi.mocked(BeadsService.prototype.show).mockResolvedValue({
      id: "task-1",
      title: "Blocked Task",
      status: "blocked",
      issue_type: "task",
      dependencies: [],
    } as BeadsIssue);
    vi.spyOn(BeadsService.prototype, "update").mockResolvedValue(undefined as never);
    vi.spyOn(BeadsService.prototype, "sync").mockResolvedValue(undefined as never);

    await taskService.listTasks("proj-1");
    const callsAfterFirst = jsonlReadCalls;

    await taskService.unblock("proj-1", "task-1");

    await taskService.listTasks("proj-1");
    expect(jsonlReadCalls).toBeGreaterThan(callsAfterFirst);
  });
});
