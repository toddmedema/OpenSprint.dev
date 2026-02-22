import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useExecuteSwimlanes } from "./useExecuteSwimlanes";
import type { Task, Plan } from "@opensprint/shared";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Implement feature",
    description: "",
    type: "task",
    status: "open",
    priority: 1,
    assignee: null,
    labels: [],
    dependencies: [],
    epicId: "epic-a",
    kanbanColumn: "ready",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    content: "# Epic A Plan\n\nOverview.",
    status: "building",
    taskCount: 1,
    doneTaskCount: 0,
    dependencyCount: 0,
    metadata: {
      planId: "plan-1",
      beadEpicId: "epic-a",
      gateTaskId: "epic-a.0",
      shippedAt: null,
      complexity: "medium",
    },
    ...overrides,
  };
}

describe("useExecuteSwimlanes", () => {
  it("filters out epics and gating tasks from implTasks", () => {
    const tasks: Task[] = [
      task({ id: "epic-a", type: "epic", epicId: null }),
      task({ id: "epic-a.0", title: "Gate", epicId: "epic-a" }),
      task({ id: "epic-a.1", title: "Task 1", epicId: "epic-a" }),
    ];
    const plans: Plan[] = [plan()];
    const { result } = renderHook(() => useExecuteSwimlanes(tasks, plans, "all", ""));
    expect(result.current.implTasks).toHaveLength(1);
    expect(result.current.implTasks[0].id).toBe("epic-a.1");
  });

  it("groups tasks by epic into swimlanes", () => {
    const tasks: Task[] = [
      task({ id: "epic-a.1", epicId: "epic-a", title: "A1" }),
      task({ id: "epic-a.2", epicId: "epic-a", title: "A2" }),
      task({ id: "epic-b.1", epicId: "epic-b", title: "B1" }),
    ];
    const plans: Plan[] = [
      plan({
        content: "# Epic A\n",
        metadata: {
          planId: "p1",
          beadEpicId: "epic-a",
          gateTaskId: "epic-a.0",
          shippedAt: null,
          complexity: "medium",
        },
      }),
      plan({
        content: "# Epic B\n",
        metadata: {
          planId: "p2",
          beadEpicId: "epic-b",
          gateTaskId: "epic-b.0",
          shippedAt: null,
          complexity: "medium",
        },
      }),
    ];
    const { result } = renderHook(() => useExecuteSwimlanes(tasks, plans, "all", ""));
    expect(result.current.swimlanes.length).toBeGreaterThanOrEqual(2);
    const laneA = result.current.swimlanes.find((s) => s.epicId === "epic-a");
    expect(laneA).toBeDefined();
    expect(laneA!.tasks).toHaveLength(2);
    expect(laneA!.epicTitle).toBe("Epic A");
  });

  it("returns chipConfig with counts", () => {
    const tasks: Task[] = [
      task({ id: "epic-a.1", kanbanColumn: "ready" }),
      task({ id: "epic-a.2", kanbanColumn: "done" }),
    ];
    const plans: Plan[] = [plan()];
    const { result } = renderHook(() => useExecuteSwimlanes(tasks, plans, "all", ""));
    expect(result.current.chipConfig).toBeDefined();
    expect(result.current.chipConfig.some((c) => c.filter === "all" && c.count === 2)).toBe(true);
    expect(result.current.chipConfig.some((c) => c.filter === "ready" && c.count === 1)).toBe(true);
    expect(result.current.chipConfig.some((c) => c.filter === "done" && c.count === 1)).toBe(true);
  });

  it("filters by search query", () => {
    const tasks: Task[] = [
      task({ id: "epic-a.1", title: "Login form", epicId: "epic-a" }),
      task({ id: "epic-a.2", title: "Logout button", epicId: "epic-a" }),
    ];
    const plans: Plan[] = [plan()];
    const { result } = renderHook(() => useExecuteSwimlanes(tasks, plans, "all", "Login"));
    expect(result.current.implTasks).toHaveLength(2);
    expect(result.current.swimlanes[0].tasks).toHaveLength(1);
    expect(result.current.swimlanes[0].tasks[0].title).toBe("Login form");
  });
});
