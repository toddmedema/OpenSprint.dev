import { describe, it, expect } from "vitest";
import {
  MAX_TASKS_PER_PLAN,
  validateTaskBatchSize,
  findPlannerTaskArray,
} from "../services/plan/planner-normalize.js";

describe("MAX_TASKS_PER_PLAN", () => {
  it("equals 15", () => {
    expect(MAX_TASKS_PER_PLAN).toBe(15);
  });
});

describe("validateTaskBatchSize", () => {
  it("returns valid for 0 tasks", () => {
    const result = validateTaskBatchSize([]);
    expect(result).toEqual({ valid: true, count: 0, excess: 0 });
  });

  it("returns valid for exactly 15 tasks", () => {
    const tasks = Array.from({ length: 15 }, (_, i) => ({ title: `Task ${i}` }));
    const result = validateTaskBatchSize(tasks);
    expect(result).toEqual({ valid: true, count: 15, excess: 0 });
  });

  it("returns invalid for 16 tasks with excess 1", () => {
    const tasks = Array.from({ length: 16 }, (_, i) => ({ title: `Task ${i}` }));
    const result = validateTaskBatchSize(tasks);
    expect(result).toEqual({ valid: false, count: 16, excess: 1 });
  });

  it("calculates correct excess for large batches", () => {
    const tasks = Array.from({ length: 25 }, (_, i) => i);
    const result = validateTaskBatchSize(tasks);
    expect(result).toEqual({ valid: false, count: 25, excess: 10 });
  });

  it("returns valid for 1 task", () => {
    const result = validateTaskBatchSize(["single"]);
    expect(result).toEqual({ valid: true, count: 1, excess: 0 });
  });
});

describe("findPlannerTaskArray count field", () => {
  it("includes count in result for top-level tasks key", () => {
    const input = { tasks: [{ title: "A" }, { title: "B" }] };
    const result = findPlannerTaskArray(input);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(2);
    expect(result!.key).toBe("tasks");
  });

  it("includes count for task_list key", () => {
    const input = { task_list: [{ title: "A" }] };
    const result = findPlannerTaskArray(input);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(1);
  });

  it("includes count for taskList key", () => {
    const input = { taskList: [{ title: "A" }, { title: "B" }, { title: "C" }] };
    const result = findPlannerTaskArray(input);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(3);
  });

  it("includes count for nested tasks", () => {
    const input = { result: { tasks: Array.from({ length: 5 }, (_, i) => ({ title: `T${i}` })) } };
    const result = findPlannerTaskArray(input);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(5);
    expect(result!.path).toBe("$.result.tasks");
  });

  it("returns null for empty object", () => {
    expect(findPlannerTaskArray({})).toBeNull();
  });

  it("includes count of 0 for empty tasks array", () => {
    const result = findPlannerTaskArray({ tasks: [] });
    expect(result).not.toBeNull();
    expect(result!.count).toBe(0);
  });
});
