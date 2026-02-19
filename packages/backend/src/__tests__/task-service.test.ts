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

describe("TaskService", () => {
  let taskService: TaskService;
  let beadsShowCalls: number;
  let beadsListAllCalls: number;
  let beadsReadyCalls: number;

  beforeEach(async () => {
    beadsCache.clear();
    beadsShowCalls = 0;
    beadsListAllCalls = 0;
    beadsReadyCalls = 0;

    const { BeadsService } = await import("../services/beads.service.js");
    vi.spyOn(BeadsService.prototype, "show").mockImplementation(async () => {
      beadsShowCalls++;
      return {
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
      } as BeadsIssue;
    });
    vi.spyOn(BeadsService.prototype, "listAll").mockImplementation(async () => {
      beadsListAllCalls++;
      return [
        {
          id: "task-1",
          title: "Test Task",
          status: "open",
          issue_type: "task",
          dependencies: [],
        },
      ] as BeadsIssue[];
    });
    vi.spyOn(BeadsService.prototype, "ready").mockImplementation(async () => {
      beadsReadyCalls++;
      return [];
    });

    taskService = new TaskService();
  });

  it("getTask does not call beads.ready (avoids N bd show calls)", async () => {
    const task = await taskService.getTask("proj-1", "task-1");
    expect(task).toBeDefined();
    expect(task.id).toBe("task-1");
    expect(task.title).toBe("Test Task");
    expect(beadsReadyCalls).toBe(0);
    expect(beadsShowCalls).toBe(1);
    expect(beadsListAllCalls).toBe(1);
  });

  it("getTask uses cache on second call (reduces bd invocations)", async () => {
    await taskService.getTask("proj-1", "task-1");
    await taskService.getTask("proj-1", "task-1");
    expect(beadsShowCalls).toBe(1);
    expect(beadsListAllCalls).toBe(1);
  });

  it("listTasks does not call beads.ready (computes ready from listAll)", async () => {
    const tasks = await taskService.listTasks("proj-1");
    expect(tasks).toBeDefined();
    expect(beadsReadyCalls).toBe(0);
    expect(beadsListAllCalls).toBe(1);
  });

  it("getReadyTasks does not call beads.ready (computes ready from listAll)", async () => {
    const tasks = await taskService.getReadyTasks("proj-1");
    expect(tasks).toBeDefined();
    expect(beadsReadyCalls).toBe(0);
    expect(beadsListAllCalls).toBe(1);
  });

  it("listTasks computes ready status from listAll: task with no blockers is ready", async () => {
    const { BeadsService } = await import("../services/beads.service.js");
    vi.mocked(BeadsService.prototype.listAll).mockResolvedValue([
      {
        id: "task-a",
        title: "Task A",
        status: "open",
        issue_type: "task",
        dependencies: [],
      },
    ] as BeadsIssue[]);

    const tasks = await taskService.listTasks("proj-1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].kanbanColumn).toBe("ready");
  });

  it("listTasks computes ready status: task with open blocker is backlog", async () => {
    const { BeadsService } = await import("../services/beads.service.js");
    vi.mocked(BeadsService.prototype.listAll).mockResolvedValue([
      { id: "blocker-1", status: "open", issue_type: "task", dependencies: [] },
      {
        id: "task-a",
        title: "Task A",
        status: "open",
        issue_type: "task",
        dependencies: [{ type: "blocks", depends_on_id: "blocker-1" }],
      },
    ] as BeadsIssue[]);

    const tasks = await taskService.listTasks("proj-1");
    const taskA = tasks.find((t) => t.id === "task-a");
    expect(taskA).toBeDefined();
    expect(taskA!.kanbanColumn).toBe("backlog");
  });

  it("listTasks computes ready status: task with closed blocker is ready", async () => {
    const { BeadsService } = await import("../services/beads.service.js");
    vi.mocked(BeadsService.prototype.listAll).mockResolvedValue([
      { id: "blocker-1", status: "closed", issue_type: "task", dependencies: [] },
      {
        id: "task-a",
        title: "Task A",
        status: "open",
        issue_type: "task",
        dependencies: [{ type: "blocks", depends_on_id: "blocker-1" }],
      },
    ] as BeadsIssue[]);

    const tasks = await taskService.listTasks("proj-1");
    const taskA = tasks.find((t) => t.id === "task-a");
    expect(taskA).toBeDefined();
    expect(taskA!.kanbanColumn).toBe("ready");
  });

  it("listTasks excludes epics from ready (epics are containers, not work items)", async () => {
    const { BeadsService } = await import("../services/beads.service.js");
    vi.mocked(BeadsService.prototype.listAll).mockResolvedValue([
      { id: "epic-1", status: "open", issue_type: "epic", dependencies: [] },
    ] as BeadsIssue[]);

    const tasks = await taskService.listTasks("proj-1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].kanbanColumn).not.toBe("ready");
  });

  it("getReadyTasks returns only ready tasks (excludes tasks with open blockers)", async () => {
    const { BeadsService } = await import("../services/beads.service.js");
    vi.mocked(BeadsService.prototype.listAll).mockResolvedValue([
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
    ] as BeadsIssue[]);

    const tasks = await taskService.getReadyTasks("proj-1");
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain("task-ready");
    expect(ids).toContain("blocker-2"); // open, no deps -> ready
    expect(ids).not.toContain("task-not-ready"); // blocked by open blocker-2
    expect(ids).not.toContain("blocker-1"); // closed -> not ready
  });

  it("listTasks calls loadSessionsGroupedByTaskId once (batch enrich, not N listSessions)", async () => {
    const { BeadsService } = await import("../services/beads.service.js");
    const manyTasks: BeadsIssue[] = Array.from({ length: 10 }, (_, i) => ({
      id: `task-${i}`,
      title: `Task ${i}`,
      status: "open" as const,
      issue_type: "task" as const,
      dependencies: [],
    }));
    vi.mocked(BeadsService.prototype.listAll).mockResolvedValue(manyTasks);

    const loadSpy = vi.spyOn(SessionManager.prototype, "loadSessionsGroupedByTaskId");
    const listSpy = vi.spyOn(SessionManager.prototype, "listSessions");

    await taskService.listTasks("proj-1");

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).not.toHaveBeenCalled();

    loadSpy.mockRestore();
    listSpy.mockRestore();
  });

  it("listTasks enriches tasks with testResults from latest session", async () => {
    const { BeadsService } = await import("../services/beads.service.js");
    vi.mocked(BeadsService.prototype.listAll).mockResolvedValue([
      { id: "task-with-session", title: "Task A", status: "open", issue_type: "task", dependencies: [] },
      { id: "task-no-session", title: "Task B", status: "open", issue_type: "task", dependencies: [] },
    ] as BeadsIssue[]);

    const loadSpy = vi.spyOn(SessionManager.prototype, "loadSessionsGroupedByTaskId").mockResolvedValue(
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
});
