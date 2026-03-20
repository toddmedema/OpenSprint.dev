import { describe, it, expect } from "vitest";
import {
  sortEpicTasksByStatus,
  sortTasksForTimeline,
  getTimelineSection,
  TIMELINE_SECTION,
} from "./executeTaskSort";
import type { Task } from "@opensprint/shared";

function createTask(
  overrides: Partial<{
    id: string;
    title: string;
    kanbanColumn: Task["kanbanColumn"];
    priority: number;
    createdAt: string;
    updatedAt: string;
  }>
): Task {
  return {
    id: overrides.id ?? "task-1",
    title: overrides.title ?? "Task",
    description: "",
    type: "task",
    status: "open",
    priority: (overrides.priority ?? 1) as 0 | 1 | 2 | 3 | 4,
    assignee: null,
    labels: [],
    dependencies: [],
    epicId: "epic-1",
    kanbanColumn: overrides.kanbanColumn ?? "backlog",
    createdAt: overrides.createdAt ?? "",
    updatedAt: overrides.updatedAt ?? "",
    ...overrides,
  };
}

describe("sortEpicTasksByStatus", () => {
  it("groups tasks by status: In Progress → In Review → Ready → Backlog → Done", () => {
    const tasks = [
      createTask({ id: "a", kanbanColumn: "done", priority: 0 }),
      createTask({ id: "b", kanbanColumn: "in_progress", priority: 0 }),
      createTask({ id: "c", kanbanColumn: "ready", priority: 0 }),
      createTask({ id: "d", kanbanColumn: "backlog", priority: 0 }),
      createTask({ id: "e", kanbanColumn: "in_review", priority: 0 }),
    ];
    const sorted = sortEpicTasksByStatus(tasks);
    expect(sorted.map((t) => t.id)).toEqual(["b", "e", "c", "d", "a"]);
    expect(sorted.map((t) => t.kanbanColumn)).toEqual([
      "in_progress",
      "in_review",
      "ready",
      "backlog",
      "done",
    ]);
  });

  it("places waiting_to_merge after ready and before backlog", () => {
    const tasks = [
      createTask({ id: "a", kanbanColumn: "backlog", priority: 0 }),
      createTask({ id: "b", kanbanColumn: "ready", priority: 0 }),
      createTask({ id: "c", kanbanColumn: "waiting_to_merge", priority: 0 }),
    ];
    const sorted = sortEpicTasksByStatus(tasks);
    expect(sorted.map((t) => t.kanbanColumn)).toEqual(["ready", "waiting_to_merge", "backlog"]);
  });

  it("places planning and blocked after backlog, before done", () => {
    const tasks = [
      createTask({ id: "a", kanbanColumn: "done", priority: 0 }),
      createTask({ id: "b", kanbanColumn: "planning", priority: 0 }),
      createTask({ id: "c", kanbanColumn: "blocked", priority: 0 }),
      createTask({ id: "d", kanbanColumn: "backlog", priority: 0 }),
    ];
    const sorted = sortEpicTasksByStatus(tasks);
    expect(sorted.map((t) => t.kanbanColumn)).toEqual(["backlog", "planning", "blocked", "done"]);
  });

  it("sorts by priority (0 highest) within same status group", () => {
    const tasks = [
      createTask({ id: "a", kanbanColumn: "ready", priority: 2 }),
      createTask({ id: "b", kanbanColumn: "ready", priority: 0 }),
      createTask({ id: "c", kanbanColumn: "ready", priority: 1 }),
    ];
    const sorted = sortEpicTasksByStatus(tasks);
    expect(sorted.map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(sorted.map((t) => t.priority)).toEqual([0, 1, 2]);
  });

  it("uses ID as tiebreaker when priority is equal", () => {
    const tasks = [
      createTask({ id: "epic-1.3", kanbanColumn: "ready", priority: 0 }),
      createTask({ id: "epic-1.1", kanbanColumn: "ready", priority: 0 }),
      createTask({ id: "epic-1.2", kanbanColumn: "ready", priority: 0 }),
    ];
    const sorted = sortEpicTasksByStatus(tasks);
    expect(sorted.map((t) => t.id)).toEqual(["epic-1.1", "epic-1.2", "epic-1.3"]);
  });

  it("does not mutate the input array", () => {
    const tasks = [
      createTask({ id: "a", kanbanColumn: "done", priority: 0 }),
      createTask({ id: "b", kanbanColumn: "in_progress", priority: 0 }),
    ];
    const originalOrder = tasks.map((t) => t.id);
    sortEpicTasksByStatus(tasks);
    expect(tasks.map((t) => t.id)).toEqual(originalOrder);
  });

  it("returns empty array for empty input", () => {
    expect(sortEpicTasksByStatus([])).toEqual([]);
  });

  it("handles single task", () => {
    const tasks = [createTask({ id: "only", kanbanColumn: "in_review", priority: 1 })];
    expect(sortEpicTasksByStatus(tasks)).toHaveLength(1);
    expect(sortEpicTasksByStatus(tasks)[0].id).toBe("only");
  });
});

describe("getTimelineSection", () => {
  it("maps in_progress and in_review to active", () => {
    expect(getTimelineSection("in_progress")).toBe(TIMELINE_SECTION.active);
    expect(getTimelineSection("in_review")).toBe(TIMELINE_SECTION.active);
  });

  it("maps ready, waiting_to_merge, backlog, planning, blocked to queue", () => {
    expect(getTimelineSection("ready")).toBe(TIMELINE_SECTION.queue);
    expect(getTimelineSection("waiting_to_merge")).toBe(TIMELINE_SECTION.queue);
    expect(getTimelineSection("backlog")).toBe(TIMELINE_SECTION.queue);
    expect(getTimelineSection("planning")).toBe(TIMELINE_SECTION.queue);
    expect(getTimelineSection("blocked")).toBe(TIMELINE_SECTION.queue);
  });

  it("maps done to completed", () => {
    expect(getTimelineSection("done")).toBe(TIMELINE_SECTION.completed);
  });
});

describe("sortTasksForTimeline", () => {
  it("returns tasks in correct three-tier order: active → queue → completed", () => {
    const tasks = [
      createTask({ id: "d", kanbanColumn: "done", updatedAt: "2024-01-04T12:00:00Z" }),
      createTask({ id: "b", kanbanColumn: "in_progress", updatedAt: "2024-01-02T12:00:00Z" }),
      createTask({ id: "c", kanbanColumn: "ready", updatedAt: "2024-01-03T12:00:00Z" }),
      createTask({ id: "a", kanbanColumn: "in_review", updatedAt: "2024-01-01T12:00:00Z" }),
    ];
    const sorted = sortTasksForTimeline(tasks);
    expect(sorted.map((t) => t.id)).toEqual(["b", "a", "c", "d"]);
    expect(sorted.map((t) => t.kanbanColumn)).toEqual([
      "in_progress",
      "in_review",
      "ready",
      "done",
    ]);
  });

  it("sorts all-done by updatedAt descending", () => {
    const tasks = [
      createTask({ id: "a", kanbanColumn: "done", updatedAt: "2024-01-01T12:00:00Z" }),
      createTask({ id: "b", kanbanColumn: "done", updatedAt: "2024-01-03T12:00:00Z" }),
      createTask({ id: "c", kanbanColumn: "done", updatedAt: "2024-01-02T12:00:00Z" }),
    ];
    const sorted = sortTasksForTimeline(tasks);
    expect(sorted.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts all-active by updatedAt descending", () => {
    const tasks = [
      createTask({ id: "a", kanbanColumn: "in_progress", updatedAt: "2024-01-01T12:00:00Z" }),
      createTask({ id: "b", kanbanColumn: "in_review", updatedAt: "2024-01-03T12:00:00Z" }),
      createTask({ id: "c", kanbanColumn: "in_progress", updatedAt: "2024-01-02T12:00:00Z" }),
    ];
    const sorted = sortTasksForTimeline(tasks);
    expect(sorted.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts waiting_to_merge with other queue-tier columns by updatedAt descending", () => {
    const tasks = [
      createTask({
        id: "merge-old",
        kanbanColumn: "waiting_to_merge",
        updatedAt: "2024-01-01T12:00:00Z",
      }),
      createTask({ id: "ready-new", kanbanColumn: "ready", updatedAt: "2024-01-05T12:00:00Z" }),
      createTask({
        id: "merge-mid",
        kanbanColumn: "waiting_to_merge",
        updatedAt: "2024-01-03T12:00:00Z",
      }),
    ];
    const sorted = sortTasksForTimeline(tasks);
    expect(sorted.map((t) => t.id)).toEqual(["ready-new", "merge-mid", "merge-old"]);
    expect(sorted.map((t) => t.kanbanColumn)).toEqual([
      "ready",
      "waiting_to_merge",
      "waiting_to_merge",
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(sortTasksForTimeline([])).toEqual([]);
  });

  it("falls back to createdAt when updatedAt is missing", () => {
    const tasks = [
      createTask({
        id: "a",
        kanbanColumn: "ready",
        updatedAt: "",
        createdAt: "2024-01-01T12:00:00Z",
      }),
      createTask({
        id: "b",
        kanbanColumn: "ready",
        updatedAt: "",
        createdAt: "2024-01-03T12:00:00Z",
      }),
    ];
    const sorted = sortTasksForTimeline(tasks);
    expect(sorted.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("uses id as tiebreaker when timestamps are equal", () => {
    const ts = "2024-01-01T12:00:00Z";
    const tasks = [
      createTask({ id: "task-z", kanbanColumn: "ready", updatedAt: ts }),
      createTask({ id: "task-a", kanbanColumn: "ready", updatedAt: ts }),
      createTask({ id: "task-m", kanbanColumn: "ready", updatedAt: ts }),
    ];
    const sorted = sortTasksForTimeline(tasks);
    expect(sorted.map((t) => t.id)).toEqual(["task-a", "task-m", "task-z"]);
  });

  it("is stable for equal timestamps (preserves relative order when ids equal)", () => {
    const ts = "2024-01-01T12:00:00Z";
    const tasks = [
      createTask({ id: "same", kanbanColumn: "ready", updatedAt: ts }),
      createTask({ id: "same", kanbanColumn: "ready", updatedAt: ts }),
    ];
    const sorted = sortTasksForTimeline(tasks);
    expect(sorted).toHaveLength(2);
    expect(sorted[0].id).toBe("same");
    expect(sorted[1].id).toBe("same");
  });

  it("does not mutate the input array", () => {
    const tasks = [
      createTask({ id: "a", kanbanColumn: "done", updatedAt: "2024-01-01T12:00:00Z" }),
      createTask({ id: "b", kanbanColumn: "in_progress", updatedAt: "2024-01-02T12:00:00Z" }),
    ];
    const originalOrder = tasks.map((t) => t.id);
    sortTasksForTimeline(tasks);
    expect(tasks.map((t) => t.id)).toEqual(originalOrder);
  });
});
