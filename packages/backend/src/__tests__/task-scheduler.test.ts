import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskStoreService } from "../services/task-store.service.js";
import { TaskScheduler } from "../services/task-scheduler.js";
import type { AgentSlot } from "../services/orchestrator.service.js";
import type { FileScope } from "../services/file-scope-analyzer.js";
import { TimerRegistry } from "../services/timer-registry.js";

function makeTask(id: string, priority = 2, labels: string[] = []) {
  return {
    id,
    title: `Task ${id}`,
    status: "open",
    priority,
    issue_type: "task",
    type: "task",
    labels,
    assignee: null,
    description: "",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
}

function makeSlot(taskId: string, fileScope?: FileScope): AgentSlot {
  return {
    taskId,
    taskTitle: `Task ${taskId}`,
    branchName: `opensprint/${taskId}`,
    worktreePath: null,
    agent: {
      activeProcess: null,
      lastOutputTime: 0,
      outputLog: [],
      outputLogBytes: 0,
      startedAt: "",
      exitHandled: false,
      killedDueToTimeout: false,
    },
    phase: "coding",
    attempt: 1,
    phaseResult: { codingDiff: "", codingSummary: "", testResults: null, testOutput: "" },
    infraRetries: 0,
    timers: new TimerRegistry(),
    fileScope,
  };
}

describe("TaskScheduler", () => {
  let scheduler: TaskScheduler;
  let mockTaskStore: {
    getStatusMap: ReturnType<typeof vi.fn>;
    areAllBlockersClosed: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    getBlockers: ReturnType<typeof vi.fn>;
    getBlockersFromIssue: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockTaskStore = {
      getStatusMap: vi.fn().mockResolvedValue(new Map()),
      areAllBlockersClosed: vi.fn().mockResolvedValue(true),
      show: vi.fn().mockResolvedValue(makeTask("dep")),
      getBlockers: vi.fn().mockResolvedValue([]),
      getBlockersFromIssue: vi.fn().mockReturnValue([]),
    };
    scheduler = new TaskScheduler(mockTaskStore as TaskStoreService);
  });

  describe("basic selection", () => {
    it("selects top-priority task when one slot available", async () => {
      const tasks = [makeTask("a", 1), makeTask("b", 2)];
      const result = await scheduler.selectTasks("proj", "/repo", tasks, new Map(), 1);
      expect(result).toHaveLength(1);
      expect(result[0].task.id).toBe("a");
    });

    it("returns empty when no slots available", async () => {
      const slots = new Map([["a", makeSlot("a")]]);
      const result = await scheduler.selectTasks("proj", "/repo", [makeTask("b")], slots, 1);
      expect(result).toHaveLength(0);
    });

    it("excludes tasks already in a slot", async () => {
      const slots = new Map([["a", makeSlot("a")]]);
      const tasks = [makeTask("a"), makeTask("b")];
      const result = await scheduler.selectTasks("proj", "/repo", tasks, slots, 2);
      expect(result).toHaveLength(1);
      expect(result[0].task.id).toBe("b");
    });

    it("skips epic-type tasks", async () => {
      const epic = { ...makeTask("epic"), issue_type: "epic", type: "epic" };
      const tasks = [epic, makeTask("real")];
      const result = await scheduler.selectTasks("proj", "/repo", tasks, new Map(), 1);
      expect(result).toHaveLength(1);
      expect(result[0].task.id).toBe("real");
    });

    it("skips blocked tasks", async () => {
      const blocked = { ...makeTask("blocked"), status: "blocked" };
      const tasks = [blocked, makeTask("open")];
      const result = await scheduler.selectTasks("proj", "/repo", tasks, new Map(), 1);
      expect(result).toHaveLength(1);
      expect(result[0].task.id).toBe("open");
    });

    it("skips tasks with unclosed blockers", async () => {
      mockTaskStore.areAllBlockersClosed.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const tasks = [makeTask("a"), makeTask("b")];
      const result = await scheduler.selectTasks("proj", "/repo", tasks, new Map(), 1);
      expect(result).toHaveLength(1);
      expect(result[0].task.id).toBe("b");
    });
  });

  describe("parallel dispatch with file-scope overlap detection", () => {
    it("dispatches two non-overlapping tasks in parallel", async () => {
      const taskA = makeTask("a", 2, ['files:{"modify":["src/frontend/A.tsx"]}']);
      const taskB = makeTask("b", 2, ['files:{"modify":["src/backend/B.ts"]}']);
      const result = await scheduler.selectTasks("proj", "/repo", [taskA, taskB], new Map(), 2);
      expect(result).toHaveLength(2);
    });

    it("serializes overlapping tasks (same file)", async () => {
      const taskA = makeTask("a", 2, ['files:{"modify":["src/shared/config.ts"]}']);
      const taskB = makeTask("b", 2, ['files:{"modify":["src/shared/config.ts"]}']);
      const result = await scheduler.selectTasks("proj", "/repo", [taskA, taskB], new Map(), 2);
      expect(result).toHaveLength(1);
      expect(result[0].task.id).toBe("a");
    });

    it("checks overlap against active slots", async () => {
      const activeScope = {
        taskId: "active",
        files: new Set(["src/shared/config.ts"]),
        directories: new Set(["src/shared"]),
        confidence: "explicit" as const,
      };
      const slots = new Map([["active", makeSlot("active", activeScope)]]);
      const taskB = makeTask("b", 2, ['files:{"modify":["src/shared/config.ts"]}']);
      const taskC = makeTask("c", 2, ['files:{"modify":["src/other/file.ts"]}']);

      const result = await scheduler.selectTasks("proj", "/repo", [taskB, taskC], slots, 3);
      expect(result).toHaveLength(1);
      expect(result[0].task.id).toBe("c");
    });

    it("serializes heuristic tasks in conservative mode when another slot is active", async () => {
      const activeScope = {
        taskId: "active",
        files: new Set(["src/shared/config.ts"]),
        directories: new Set(["src/shared"]),
        confidence: "explicit" as const,
      };
      const slots = new Map([["active", makeSlot("active", activeScope)]]);
      const heuristicTask = makeTask("heuristic");

      const result = await scheduler.selectTasks("proj", "/repo", [heuristicTask], slots, 2, {
        unknownScopeStrategy: "conservative",
      });

      expect(result).toHaveLength(0);
    });

    it("allows heuristic tasks in optimistic mode when they do not overlap known scopes", async () => {
      const explicitTask = makeTask("explicit", 2, ['files:{"modify":["src/frontend/A.tsx"]}']);
      const heuristicTask = {
        ...makeTask("heuristic"),
        description: "Touch packages/backend/src/services only",
      };

      const result = await scheduler.selectTasks(
        "proj",
        "/repo",
        [explicitTask, heuristicTask],
        new Map(),
        2,
        { unknownScopeStrategy: "optimistic" }
      );

      expect(result).toHaveLength(2);
      expect(result[1].task.id).toBe("heuristic");
    });

    it("maxConcurrentCoders: 1 dispatches one at a time", async () => {
      const tasks = [makeTask("a"), makeTask("b")];
      const result = await scheduler.selectTasks("proj", "/repo", tasks, new Map(), 1);
      expect(result).toHaveLength(1);
    });

    it("returns fileScope with each result", async () => {
      const task = makeTask("a", 2, ['files:{"modify":["src/a.ts"],"create":["src/b.ts"]}']);
      const result = await scheduler.selectTasks("proj", "/repo", [task], new Map(), 1);
      expect(result).toHaveLength(1);
      expect(result[0].fileScope).toBeDefined();
      expect(result[0].fileScope.confidence).toBe("explicit");
      expect(result[0].fileScope.files.has("src/a.ts")).toBe(true);
    });
  });
});
