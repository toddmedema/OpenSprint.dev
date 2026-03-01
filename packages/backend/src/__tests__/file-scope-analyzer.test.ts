import { describe, it, expect, vi } from "vitest";
import { FileScopeAnalyzer } from "../services/file-scope-analyzer.js";
import type { TaskStoreService } from "../services/task-store.service.js";

function makeTask(labels: string[] = [], description = "") {
  return {
    id: "os-scope",
    title: "Scope task",
    status: "open",
    priority: 2,
    issue_type: "task",
    type: "task",
    labels,
    assignee: null,
    description,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
}

describe("FileScopeAnalyzer", () => {
  it("prefers conflict_files over explicit planner scope and heuristics", async () => {
    const analyzer = new FileScopeAnalyzer();
    const task = makeTask([
      'conflict_files:["src/conflict.ts"]',
      'files:{"modify":["src/explicit.ts"],"create":["src/new.ts"],"test":["src/__tests__/new.test.ts"]}',
    ]);
    const taskStore = {
      getBlockersFromIssue: vi.fn().mockReturnValue([]),
    } as unknown as TaskStoreService;

    const scope = await analyzer.predict("proj", "/repo", task, taskStore, {
      idToIssue: new Map([[task.id, task as never]]),
    });

    expect(scope.confidence).toBe("explicit");
    expect([...scope.files]).toEqual(["src/conflict.ts"]);
  });

  it("uses current task actual_files before dependency inference", async () => {
    const analyzer = new FileScopeAnalyzer();
    const task = makeTask(['actual_files:["src/retry.ts"]']);
    const taskStore = {
      getBlockersFromIssue: vi.fn().mockReturnValue(["dep-1"]),
      show: vi.fn().mockResolvedValue(makeTask(['actual_files:["src/dep.ts"]'])),
    } as unknown as TaskStoreService;

    const scope = await analyzer.predict("proj", "/repo", task, taskStore, {
      idToIssue: new Map([
        [task.id, task as never],
        ["dep-1", makeTask(['actual_files:["src/dep.ts"]']) as never],
      ]),
    });

    expect(scope.confidence).toBe("explicit");
    expect(scope.files.has("src/retry.ts")).toBe(true);
    expect(scope.files.has("src/dep.ts")).toBe(false);
  });
});
