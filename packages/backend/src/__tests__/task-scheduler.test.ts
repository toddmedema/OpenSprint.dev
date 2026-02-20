import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskScheduler } from "../services/task-scheduler.js";
import type { AgentSlot } from "../services/orchestrator.service.js";
import { TimerRegistry } from "../services/timer-registry.js";

function makeTask(id: string, priority = 2) {
  return {
    id,
    title: `Task ${id}`,
    status: "open",
    priority,
    issue_type: "task",
    type: "task",
    labels: [],
    assignee: null,
    description: "",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
}

function makeSlot(taskId: string): AgentSlot {
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
  };
}

describe("TaskScheduler", () => {
  let scheduler: TaskScheduler;
  let mockBeads: {
    getStatusMap: ReturnType<typeof vi.fn>;
    areAllBlockersClosed: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockBeads = {
      getStatusMap: vi.fn().mockResolvedValue(new Map()),
      areAllBlockersClosed: vi.fn().mockResolvedValue(true),
    };
    scheduler = new TaskScheduler(mockBeads as any);
  });

  it("selects top-priority task when one slot available", async () => {
    const tasks = [makeTask("a", 1), makeTask("b", 2)];
    const result = await scheduler.selectTasks("/repo", tasks, new Map(), 1);
    expect(result).toHaveLength(1);
    expect(result[0].task.id).toBe("a");
  });

  it("returns empty when no slots available", async () => {
    const slots = new Map([["a", makeSlot("a")]]);
    const result = await scheduler.selectTasks("/repo", [makeTask("b")], slots, 1);
    expect(result).toHaveLength(0);
  });

  it("selects multiple tasks when multiple slots available", async () => {
    const tasks = [makeTask("a"), makeTask("b"), makeTask("c")];
    const result = await scheduler.selectTasks("/repo", tasks, new Map(), 3);
    expect(result).toHaveLength(3);
  });

  it("excludes tasks already in a slot", async () => {
    const slots = new Map([["a", makeSlot("a")]]);
    const tasks = [makeTask("a"), makeTask("b")];
    const result = await scheduler.selectTasks("/repo", tasks, slots, 2);
    expect(result).toHaveLength(1);
    expect(result[0].task.id).toBe("b");
  });

  it("skips plan approval gate tasks", async () => {
    const gate = { ...makeTask("gate"), title: "Plan approval gate" };
    const tasks = [gate, makeTask("real")];
    const result = await scheduler.selectTasks("/repo", tasks, new Map(), 1);
    expect(result).toHaveLength(1);
    expect(result[0].task.id).toBe("real");
  });

  it("skips epic-type tasks", async () => {
    const epic = { ...makeTask("epic"), issue_type: "epic", type: "epic" };
    const tasks = [epic, makeTask("real")];
    const result = await scheduler.selectTasks("/repo", tasks, new Map(), 1);
    expect(result).toHaveLength(1);
    expect(result[0].task.id).toBe("real");
  });

  it("skips blocked tasks", async () => {
    const blocked = { ...makeTask("blocked"), status: "blocked" };
    const tasks = [blocked, makeTask("open")];
    const result = await scheduler.selectTasks("/repo", tasks, new Map(), 1);
    expect(result).toHaveLength(1);
    expect(result[0].task.id).toBe("open");
  });

  it("skips tasks with unclosed blockers", async () => {
    mockBeads.areAllBlockersClosed
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const tasks = [makeTask("a"), makeTask("b")];
    const result = await scheduler.selectTasks("/repo", tasks, new Map(), 1);
    expect(result).toHaveLength(1);
    expect(result[0].task.id).toBe("b");
  });

  it("returns empty when all candidates have unclosed blockers", async () => {
    mockBeads.areAllBlockersClosed.mockResolvedValue(false);
    const result = await scheduler.selectTasks("/repo", [makeTask("a")], new Map(), 1);
    expect(result).toHaveLength(0);
  });
});
