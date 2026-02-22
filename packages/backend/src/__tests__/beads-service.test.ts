import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BeadsService } from "../services/beads.service.js";
import * as jsonlStore from "../services/jsonl-store.js";
import { clearStoreCache } from "../services/jsonl-store.js";
import { clearJsonlCache } from "../services/jsonl-reader.js";

let mockExecImpl: (cmd: string) => Promise<{ stdout: string; stderr: string }> = async () => ({
  stdout: "{}",
  stderr: "",
});

vi.mock("util", () => ({
  promisify: () => (cmd: string, _opts?: unknown) => mockExecImpl(cmd),
}));

function writeJsonl(repoPath: string, issues: Record<string, unknown>[]): void {
  const dir = path.join(repoPath, ".beads");
  fs.mkdirSync(dir, { recursive: true });
  const content = issues.map((i) => JSON.stringify(i)).join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "issues.jsonl"), content, "utf-8");
}

function readJsonl(repoPath: string): Record<string, unknown>[] {
  const content = fs.readFileSync(path.join(repoPath, ".beads/issues.jsonl"), "utf-8");
  return content
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe("BeadsService", () => {
  let beads: BeadsService;
  let repoPath: string;

  beforeEach(() => {
    beads = new BeadsService();
    BeadsService.resetForTesting();
    clearStoreCache();
    clearJsonlCache();
    repoPath = path.join(
      os.tmpdir(),
      `beads-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    writeJsonl(repoPath, []);
    mockExecImpl = async () => ({ stdout: "{}", stderr: "" });
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  it("should be instantiable", () => {
    expect(beads).toBeInstanceOf(BeadsService);
  });

  it("should have all expected methods", () => {
    expect(typeof beads.init).toBe("function");
    expect(typeof beads.create).toBe("function");
    expect(typeof beads.createWithRetry).toBe("function");
    expect(typeof beads.update).toBe("function");
    expect(typeof beads.close).toBe("function");
    expect(typeof beads.ready).toBe("function");
    expect(typeof beads.list).toBe("function");
    expect(typeof beads.show).toBe("function");
    expect(typeof beads.addDependency).toBe("function");
    expect(typeof beads.delete).toBe("function");
    expect(typeof beads.sync).toBe("function");
    expect(typeof beads.depTree).toBe("function");
    expect(typeof beads.runBd).toBe("function");
    expect(typeof beads.getBlockers).toBe("function");
    expect(typeof beads.areAllBlockersClosed).toBe("function");
    expect(typeof beads.configSet).toBe("function");
  });

  it("runBd should return parsed JSON from bd output", async () => {
    const json = { id: "test-1", title: "Test", status: "open" };
    mockExecImpl = async () => ({ stdout: JSON.stringify(json), stderr: "" });
    const result = await beads.runBd(repoPath, "show", ["test-1", "--json"]);
    expect(result).toEqual(json);
  });

  it("runBd should return null for empty output", async () => {
    mockExecImpl = async () => ({ stdout: "\n  \n", stderr: "" });
    const result = await beads.runBd(repoPath, "close", ["x", "--reason", "done", "--json"]);
    expect(result).toBeNull();
  });

  it("runBd should throw on exec error", async () => {
    mockExecImpl = async () => {
      throw Object.assign(new Error("bd not found"), { stderr: "bd: command not found" });
    };
    await expect(beads.runBd(repoPath, "list", ["--json"])).rejects.toThrow(
      /Beads (command failed|database sync failed)/
    );
  });

  describe("create", () => {
    it("should create a top-level issue and write to JSONL", async () => {
      const result = await beads.create(repoPath, "My Task", {
        type: "task",
        priority: 1,
        description: "Test description",
      });
      expect(result.id).toBeTruthy();
      expect(result.title).toBe("My Task");
      expect(result.status).toBe("open");
      expect(result.priority).toBe(1);
      expect(result.description).toBe("Test description");
      expect(result.issue_type).toBe("task");

      const onDisk = readJsonl(repoPath);
      expect(onDisk).toHaveLength(1);
      expect(onDisk[0].title).toBe("My Task");
    });

    it("should create a child issue under a parent", async () => {
      const epic = await beads.create(repoPath, "Epic", { type: "epic" });
      const task = await beads.create(repoPath, "Child Task", {
        type: "task",
        parentId: epic.id,
      });
      expect(task.id).toBe(`${epic.id}.1`);
      expect((task.dependencies as unknown[])?.length).toBeGreaterThan(0);
    });

    it("should increment child IDs sequentially", async () => {
      const epic = await beads.create(repoPath, "Epic", { type: "epic" });
      const t1 = await beads.create(repoPath, "Task 1", { parentId: epic.id });
      const t2 = await beads.create(repoPath, "Task 2", { parentId: epic.id });
      const t3 = await beads.create(repoPath, "Task 3", { parentId: epic.id });
      expect(t1.id).toBe(`${epic.id}.1`);
      expect(t2.id).toBe(`${epic.id}.2`);
      expect(t3.id).toBe(`${epic.id}.3`);
    });
  });

  describe("createWithRetry", () => {
    it("should return issue on first-try success (no retry needed with JSONL)", async () => {
      const result = await beads.createWithRetry(repoPath, "Task", {
        type: "task",
        priority: 1,
      });
      expect(result).not.toBeNull();
      expect(result!.title).toBe("Task");
    });

    it("should accept fallbackToStandalone option for API compatibility", async () => {
      const epic = await beads.create(repoPath, "Epic", { type: "epic" });
      const result = await beads.createWithRetry(
        repoPath,
        "Task",
        { type: "task", parentId: epic.id },
        { fallbackToStandalone: true }
      );
      expect(result).not.toBeNull();
      expect(result!.id).toBe(`${epic.id}.1`);
    });

    it("should retry on duplicate key error and succeed on later attempt", async () => {
      const epic = await beads.create(repoPath, "Epic", { type: "epic" });
      const actualCreate = jsonlStore.createIssue;
      const createSpy = vi.spyOn(jsonlStore, "createIssue");
      createSpy
        .mockRejectedValueOnce(
          Object.assign(new Error("UNIQUE constraint failed"), { stderr: "duplicate key" })
        )
        .mockRejectedValueOnce(
          Object.assign(new Error("Duplicate entry"), { stderr: "Error 1062" })
        )
        .mockImplementation((p, t, o) => actualCreate(p, t, o));
      const result = await beads.createWithRetry(repoPath, "Task", {
        type: "task",
        parentId: epic.id,
      });
      expect(result).not.toBeNull();
      expect(result!.title).toBe("Task");
      expect(createSpy).toHaveBeenCalledTimes(3);
      createSpy.mockRestore();
    });

    it("should return null when fallbackToStandalone used and fallback succeeds", async () => {
      const epic = await beads.create(repoPath, "Epic", { type: "epic" });
      const actualCreate = jsonlStore.createIssue;
      const createSpy = vi.spyOn(jsonlStore, "createIssue");
      createSpy.mockImplementation(async (p, t, o) => {
        if ((o as { parentId?: string })?.parentId) {
          throw Object.assign(new Error("duplicate key"), { stderr: "UNIQUE constraint" });
        }
        return actualCreate(p, t, o);
      });
      const result = await beads.createWithRetry(
        repoPath,
        "Task",
        { type: "task", parentId: epic.id },
        { fallbackToStandalone: true }
      );
      expect(result).toBeNull();
      expect(createSpy).toHaveBeenCalledTimes(4);
      createSpy.mockRestore();
    });

    it("should return null when fallbackToStandalone used and fallback fails", async () => {
      const epic = await beads.create(repoPath, "Epic", { type: "epic" });
      const createSpy = vi.spyOn(jsonlStore, "createIssue");
      createSpy.mockRejectedValue(
        Object.assign(new Error("duplicate"), { stderr: "already exists" })
      );
      const result = await beads.createWithRetry(
        repoPath,
        "Task",
        { type: "task", parentId: epic.id },
        { fallbackToStandalone: true }
      );
      expect(result).toBeNull();
      createSpy.mockRestore();
    });

    it("should throw when non-duplicate error (no retry)", async () => {
      const createSpy = vi.spyOn(jsonlStore, "createIssue");
      createSpy.mockRejectedValueOnce(new Error("ENOENT: file not found"));
      await expect(
        beads.createWithRetry(repoPath, "Task", { type: "task" })
      ).rejects.toThrow(/ENOENT|file not found/);
      expect(createSpy).toHaveBeenCalledTimes(1);
      createSpy.mockRestore();
    });

    it("should throw when all retries exhausted and no fallbackToStandalone", async () => {
      const epic = await beads.create(repoPath, "Epic", { type: "epic" });
      const createSpy = vi.spyOn(jsonlStore, "createIssue");
      createSpy.mockRejectedValue(
        Object.assign(new Error("duplicate key"), { stderr: "UNIQUE constraint" })
      );
      await expect(
        beads.createWithRetry(repoPath, "Task", {
          type: "task",
          parentId: epic.id,
        })
      ).rejects.toThrow(/duplicate/);
      expect(createSpy).toHaveBeenCalledTimes(3);
      createSpy.mockRestore();
    });

    it("should detect duplicate via details.stderr (AppError-style) and retry", async () => {
      const epic = await beads.create(repoPath, "Epic", { type: "epic" });
      const actualCreate = jsonlStore.createIssue;
      const createSpy = vi.spyOn(jsonlStore, "createIssue");
      createSpy
        .mockRejectedValueOnce(
          Object.assign(new Error("Beads failed"), {
            details: { stderr: "UNIQUE constraint failed: duplicate entry" },
          })
        )
        .mockImplementation((p, t, o) => actualCreate(p, t, o));
      const result = await beads.createWithRetry(repoPath, "Task", {
        type: "task",
        parentId: epic.id,
      });
      expect(result).not.toBeNull();
      expect(result!.title).toBe("Task");
      expect(createSpy).toHaveBeenCalledTimes(2);
      createSpy.mockRestore();
    });
  });

  describe("update", () => {
    it("should update issue status and return result", async () => {
      const created = await beads.create(repoPath, "My Task");
      const result = await beads.update(repoPath, created.id, { status: "in_progress" });
      expect(result.id).toBe(created.id);
      expect(result.status).toBe("in_progress");
    });

    it("should support claim option (assignee + in_progress)", async () => {
      const created = await beads.create(repoPath, "My Task");
      const result = await beads.update(repoPath, created.id, {
        claim: true,
        assignee: "agent-1",
      });
      expect(result.assignee).toBe("agent-1");
      expect(result.status).toBe("in_progress");
    });

    it("should support assignee, description, and priority options", async () => {
      const created = await beads.create(repoPath, "My Task");
      const result = await beads.update(repoPath, created.id, {
        assignee: "agent-1",
        description: "Updated desc",
        priority: 0,
      });
      expect(result.assignee).toBe("agent-1");
      expect(result.description).toBe("Updated desc");
      expect(result.priority).toBe(0);
    });
  });

  describe("close", () => {
    it("should close issue with reason and return parsed result", async () => {
      const created = await beads.create(repoPath, "My Task");
      const result = await beads.close(repoPath, created.id, "Implemented and tested");
      expect(result.id).toBe(created.id);
      expect(result.status).toBe("closed");
    });

    it("should set close_reason and closed_at", async () => {
      const created = await beads.create(repoPath, "My Task");
      const result = await beads.close(repoPath, created.id, "Done");
      expect((result as Record<string, unknown>).close_reason).toBe("Done");
      expect((result as Record<string, unknown>).closed_at).toBeTruthy();
    });

    it("should persist close to JSONL", async () => {
      const created = await beads.create(repoPath, "My Task");
      await beads.close(repoPath, created.id, "Done");
      const onDisk = readJsonl(repoPath);
      const issue = onDisk.find((i) => i.id === created.id);
      expect(issue?.status).toBe("closed");
      expect(issue?.close_reason).toBe("Done");
    });
  });

  describe("list", () => {
    it("should return open and in_progress issues", async () => {
      const t1 = await beads.create(repoPath, "Task A");
      await beads.create(repoPath, "Task B");
      await beads.update(repoPath, t1.id, { status: "in_progress" });
      const t3 = await beads.create(repoPath, "Task C");
      await beads.close(repoPath, t3.id, "Done");

      const result = await beads.list(repoPath);
      expect(result).toHaveLength(2);
      expect(result.every((r) => r.status !== "closed")).toBe(true);
    });

    it("should return empty array for empty list", async () => {
      const result = await beads.list(repoPath);
      expect(result).toEqual([]);
    });
  });

  describe("show", () => {
    it("should return full issue details", async () => {
      const created = await beads.create(repoPath, "Implement login", {
        description: "Add JWT auth",
        priority: 1,
      });
      const result = await beads.show(repoPath, created.id);
      expect(result.id).toBe(created.id);
      expect(result.title).toBe("Implement login");
      expect(result.description).toBe("Add JWT auth");
    });

    it("should throw when issue not found", async () => {
      await expect(beads.show(repoPath, "nonexistent")).rejects.toThrow(
        /Issue nonexistent not found/
      );
    });
  });

  describe("listAll", () => {
    it("should return all issues including closed", async () => {
      await beads.create(repoPath, "Task A");
      const t2 = await beads.create(repoPath, "Task B");
      await beads.close(repoPath, t2.id, "Done");

      const result = await beads.listAll(repoPath);
      expect(result).toHaveLength(2);
      expect(result.some((r) => r.status === "closed")).toBe(true);
    });
  });

  describe("ready", () => {
    it("should return ready tasks (priority-sorted, deps resolved)", async () => {
      writeJsonl(repoPath, [
        { id: "t-1", title: "High priority", priority: 0, status: "open", issue_type: "task" },
        { id: "t-2", title: "Next", priority: 1, status: "open", issue_type: "task" },
      ]);
      clearStoreCache();
      clearJsonlCache();

      const result = await beads.ready(repoPath);
      expect(result).toHaveLength(2);
      expect(result[0].priority).toBe(0);
    });

    it("should return empty array when no ready tasks", async () => {
      const result = await beads.ready(repoPath);
      expect(result).toEqual([]);
    });

    it("should filter out tasks whose blockers are not closed", async () => {
      writeJsonl(repoPath, [
        { id: "t-1", title: "Blocker", priority: 0, status: "open", issue_type: "task" },
        {
          id: "t-2",
          title: "Blocked",
          priority: 1,
          status: "open",
          issue_type: "task",
          dependencies: [{ type: "blocks", depends_on_id: "t-1" }],
        },
      ]);
      clearStoreCache();
      clearJsonlCache();

      const result = await beads.ready(repoPath);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("t-1");
    });
  });

  describe("areAllBlockersClosed", () => {
    it("should return true when task has no blockers", async () => {
      writeJsonl(repoPath, [{ id: "t1", status: "open", issue_type: "task" }]);
      clearStoreCache();
      clearJsonlCache();
      expect(await beads.areAllBlockersClosed(repoPath, "t1")).toBe(true);
    });

    it("should return true when all blockers are closed", async () => {
      writeJsonl(repoPath, [
        {
          id: "t1",
          status: "open",
          issue_type: "task",
          dependencies: [{ type: "blocks", depends_on_id: "b1" }],
        },
        { id: "b1", status: "closed", issue_type: "task" },
      ]);
      clearStoreCache();
      clearJsonlCache();
      expect(await beads.areAllBlockersClosed(repoPath, "t1")).toBe(true);
    });

    it("should return false when a blocker is in_progress", async () => {
      writeJsonl(repoPath, [
        {
          id: "t1",
          status: "open",
          issue_type: "task",
          dependencies: [{ type: "blocks", depends_on_id: "b1" }],
        },
        { id: "b1", status: "in_progress", issue_type: "task" },
      ]);
      clearStoreCache();
      clearJsonlCache();
      expect(await beads.areAllBlockersClosed(repoPath, "t1")).toBe(false);
    });
  });

  describe("delete", () => {
    it("should remove the issue from JSONL", async () => {
      const created = await beads.create(repoPath, "To Delete");
      await beads.delete(repoPath, created.id);
      const onDisk = readJsonl(repoPath);
      expect(onDisk.find((i) => i.id === created.id)).toBeUndefined();
    });
  });

  describe("addDependency", () => {
    it("should add a dependency to an issue", async () => {
      const t1 = await beads.create(repoPath, "Blocker");
      const t2 = await beads.create(repoPath, "Blocked");
      await beads.addDependency(repoPath, t2.id, t1.id, "blocks");

      const updated = await beads.show(repoPath, t2.id);
      const deps = (updated.dependencies as Array<{ depends_on_id: string; type: string }>) ?? [];
      expect(deps.some((d) => d.depends_on_id === t1.id && d.type === "blocks")).toBe(true);
    });
  });

  describe("labels", () => {
    it("should add a label to an issue", async () => {
      const created = await beads.create(repoPath, "Task");
      await beads.addLabel(repoPath, created.id, "attempts:2");
      const updated = await beads.show(repoPath, created.id);
      expect((updated.labels as string[]).includes("attempts:2")).toBe(true);
    });

    it("should remove a label from an issue", async () => {
      const created = await beads.create(repoPath, "Task");
      await beads.addLabel(repoPath, created.id, "attempts:2");
      await beads.removeLabel(repoPath, created.id, "attempts:2");
      const updated = await beads.show(repoPath, created.id);
      expect((updated.labels as string[]).includes("attempts:2")).toBe(false);
    });

    it("should not duplicate labels", async () => {
      const created = await beads.create(repoPath, "Task");
      await beads.addLabel(repoPath, created.id, "foo");
      await beads.addLabel(repoPath, created.id, "foo");
      const updated = await beads.show(repoPath, created.id);
      expect((updated.labels as string[]).filter((l) => l === "foo")).toHaveLength(1);
    });
  });

  describe("getCumulativeAttempts", () => {
    it("returns 0 when no attempts label", async () => {
      const created = await beads.create(repoPath, "Task");
      expect(await beads.getCumulativeAttempts(repoPath, created.id)).toBe(0);
    });

    it("returns count from attempts:N label", async () => {
      const created = await beads.create(repoPath, "Task");
      await beads.addLabel(repoPath, created.id, "attempts:3");
      expect(await beads.getCumulativeAttempts(repoPath, created.id)).toBe(3);
    });
  });

  describe("setCumulativeAttempts", () => {
    it("adds attempts:N label when none exists", async () => {
      const created = await beads.create(repoPath, "Task");
      await beads.setCumulativeAttempts(repoPath, created.id, 2);
      const issue = await beads.show(repoPath, created.id);
      expect((issue.labels as string[]).includes("attempts:2")).toBe(true);
    });

    it("removes old attempts label before adding new one", async () => {
      const created = await beads.create(repoPath, "Task");
      await beads.setCumulativeAttempts(repoPath, created.id, 1);
      await beads.setCumulativeAttempts(repoPath, created.id, 2);
      const issue = await beads.show(repoPath, created.id);
      const attemptsLabels = (issue.labels as string[]).filter((l) => l.startsWith("attempts:"));
      expect(attemptsLabels).toEqual(["attempts:2"]);
    });
  });

  describe("listInProgressWithAgentAssignee", () => {
    it("should return only in_progress tasks with agent-N assignee", async () => {
      writeJsonl(repoPath, [
        { id: "t-1", status: "in_progress", assignee: "agent-1", issue_type: "task" },
        { id: "t-2", status: "open", assignee: "agent-1", issue_type: "task" },
        { id: "t-3", status: "in_progress", assignee: "Todd Medema", issue_type: "task" },
        { id: "t-4", status: "in_progress", assignee: "agent-2", issue_type: "task" },
        { id: "t-5", status: "in_progress", assignee: null, issue_type: "task" },
      ]);
      clearStoreCache();
      clearJsonlCache();

      const result = await beads.listInProgressWithAgentAssignee(repoPath);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.id)).toEqual(["t-1", "t-4"]);
    });
  });

  describe("sync", () => {
    it("should invalidate caches without spawning CLI", async () => {
      const execCalls: string[] = [];
      mockExecImpl = async (cmd: string) => {
        execCalls.push(cmd);
        return { stdout: "", stderr: "" };
      };
      await beads.sync(repoPath);
      expect(execCalls).toHaveLength(0);
    });
  });

  describe("export", () => {
    it("runs sync --import-only (or import fallback) before export to prevent stale DB errors", async () => {
      const execCalls: string[] = [];
      mockExecImpl = async (cmd: string) => {
        execCalls.push(cmd);
        return { stdout: "", stderr: "" };
      };
      await beads.export(repoPath, ".beads/issues.jsonl");
      const preImportIdx = execCalls.findIndex(
        (c) =>
          c.includes("sync --import-only") ||
          (c.includes("import -i") && c.includes("--orphan-handling allow"))
      );
      const exportIdx = execCalls.findIndex((c) => c.includes("export -o"));
      expect(preImportIdx).toBeGreaterThanOrEqual(0);
      expect(exportIdx).toBeGreaterThan(preImportIdx);
    });

    it("falls back to --force when export fails after sync/import", async () => {
      let exportAttempt = 0;
      const execCalls: string[] = [];
      mockExecImpl = async (cmd: string) => {
        execCalls.push(cmd);
        if (cmd.includes("sync --import-only") || cmd.includes("import -i")) {
          return { stdout: "", stderr: "" };
        }
        if (cmd.includes("export -o") && !cmd.includes("--force")) {
          exportAttempt++;
          throw Object.assign(new Error("export failed"), {
            stderr: "Error: refusing to export stale database that would lose issues\n",
          });
        }
        return { stdout: "", stderr: "" };
      };
      await beads.export(repoPath, ".beads/issues.jsonl");
      expect(exportAttempt).toBeGreaterThanOrEqual(1);
      expect(execCalls.some((c) => c.includes("--force"))).toBe(true);
    });
  });

  describe("ensureDaemon / stopDaemonsForRepos (daemon removed)", () => {
    it("stopDaemonsForRepos removes backend.pid when it matches our process pid", async () => {
      const tmpDir = path.join(os.tmpdir(), `beads-stop-test-${Date.now()}`);
      const beadsDir = path.join(tmpDir, ".beads");
      const backendPidPath = path.join(beadsDir, "backend.pid");
      fs.mkdirSync(beadsDir, { recursive: true });
      fs.writeFileSync(backendPidPath, String(process.pid), "utf-8");

      await beads.stopDaemonsForRepos([tmpDir]);
      expect(fs.existsSync(backendPidPath)).toBe(false);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("getManagedRepoPaths returns empty array (daemon subsystem removed)", () => {
      expect(BeadsService.getManagedRepoPaths()).toEqual([]);
    });
  });

  describe("ID generation", () => {
    it("should generate unique top-level IDs", async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const issue = await beads.create(repoPath, `Task ${i}`);
        expect(ids.has(issue.id)).toBe(false);
        ids.add(issue.id);
      }
    });

    it("should detect project prefix from existing issues", async () => {
      writeJsonl(repoPath, [
        { id: "myproject-abc", title: "Existing", status: "open", issue_type: "task" },
      ]);
      clearStoreCache();
      clearJsonlCache();

      const created = await beads.create(repoPath, "New Task");
      expect(created.id.startsWith("myproject-")).toBe(true);
    });
  });
});
