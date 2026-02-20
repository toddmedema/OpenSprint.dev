import { describe, it, expect, beforeEach, vi } from "vitest";
import { listTasksCache } from "../services/list-tasks-cache.js";

const mockTasks = [
  {
    id: "task-1",
    title: "Test Task",
    description: "",
    type: "task" as const,
    status: "open" as const,
    priority: 1 as const,
    assignee: null,
    labels: [],
    dependencies: [],
    epicId: null,
    kanbanColumn: "ready" as const,
    createdAt: "",
    updatedAt: "",
  },
];

describe("listTasksCache", () => {
  beforeEach(() => {
    listTasksCache.clear();
    vi.useRealTimers();
  });

  it("returns undefined when cache is empty", () => {
    expect(listTasksCache.get("/repo/path")).toBeUndefined();
  });

  it("returns cached value after set", () => {
    listTasksCache.set("/repo/path", mockTasks);
    expect(listTasksCache.get("/repo/path")).toEqual(mockTasks);
  });

  it("returns undefined after invalidate", () => {
    listTasksCache.set("/repo/path", mockTasks);
    listTasksCache.invalidate("/repo/path");
    expect(listTasksCache.get("/repo/path")).toBeUndefined();
  });

  it("invalidate does not affect other repo paths", () => {
    listTasksCache.set("/repo/a", mockTasks);
    listTasksCache.set("/repo/b", mockTasks);
    listTasksCache.invalidate("/repo/a");
    expect(listTasksCache.get("/repo/a")).toBeUndefined();
    expect(listTasksCache.get("/repo/b")).toEqual(mockTasks);
  });

  it("clear removes all entries", () => {
    listTasksCache.set("/repo/a", mockTasks);
    listTasksCache.set("/repo/b", mockTasks);
    listTasksCache.clear();
    expect(listTasksCache.get("/repo/a")).toBeUndefined();
    expect(listTasksCache.get("/repo/b")).toBeUndefined();
  });

  it("returns undefined when TTL has expired", () => {
    vi.useFakeTimers();
    listTasksCache.set("/repo/path", mockTasks);
    expect(listTasksCache.get("/repo/path")).toEqual(mockTasks);

    // Advance 8 seconds (TTL is 7s)
    vi.advanceTimersByTime(8_000);
    expect(listTasksCache.get("/repo/path")).toBeUndefined();

    vi.useRealTimers();
  });

  it("returns value when within TTL", () => {
    vi.useFakeTimers();
    listTasksCache.set("/repo/path", mockTasks);

    vi.advanceTimersByTime(3_000);
    expect(listTasksCache.get("/repo/path")).toEqual(mockTasks);

    vi.advanceTimersByTime(3_000);
    expect(listTasksCache.get("/repo/path")).toEqual(mockTasks);

    vi.useRealTimers();
  });
});
