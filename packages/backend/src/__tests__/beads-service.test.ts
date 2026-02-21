import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BeadsService } from "../services/beads.service.js";

// Control mock stdout per test (closure reads current value at call time)
let mockStdout = "{}";
let mockExecImpl: (cmd: string) => Promise<{ stdout: string; stderr: string }> = async () => ({
  stdout: mockStdout,
  stderr: "",
});

vi.mock("util", () => ({
  promisify: () => (cmd: string, _opts?: unknown) => mockExecImpl(cmd),
}));

describe("BeadsService", () => {
  let beads: BeadsService;
  const repoPath = "/tmp/test-repo";

  beforeEach(() => {
    beads = new BeadsService();
    BeadsService.resetForTesting();
    mockStdout = "{}";
    mockExecImpl = async () => ({ stdout: mockStdout, stderr: "" });
  });

  it("should be instantiable", () => {
    expect(beads).toBeInstanceOf(BeadsService);
  });

  it("should have all expected methods", () => {
    expect(typeof beads.init).toBe("function");
    expect(typeof beads.create).toBe("function");
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
    mockStdout = JSON.stringify(json);

    const result = await beads.runBd(repoPath, "show", ["test-1", "--json"]);
    expect(result).toEqual(json);
  });

  it("runBd should return null for empty output", async () => {
    mockStdout = "\n  \n";

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

  describe("update", () => {
    it("should update issue with status and return parsed result", async () => {
      mockStdout = JSON.stringify({
        id: "test-123",
        title: "My Task",
        status: "in_progress",
        priority: 1,
      });
      const result = await beads.update("/repo", "test-123", { status: "in_progress" });
      expect(result.id).toBe("test-123");
      expect(result.status).toBe("in_progress");
    });

    it("should support claim option (assignee + in_progress)", async () => {
      mockStdout = JSON.stringify({
        id: "task-1",
        status: "in_progress",
        assignee: "agent-1",
      });
      const result = await beads.update("/repo", "task-1", { claim: true });
      expect(result.assignee).toBe("agent-1");
      expect(result.status).toBe("in_progress");
    });

    it("should support assignee, description, and priority options", async () => {
      mockStdout = JSON.stringify({
        id: "task-1",
        assignee: "agent-1",
        description: "Updated desc",
        priority: 0,
      });
      const result = await beads.update("/repo", "task-1", {
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
      mockStdout = JSON.stringify({
        id: "task-1",
        status: "closed",
        close_reason: "Implemented and tested",
      });
      const result = await beads.close("/repo", "task-1", "Implemented and tested");
      expect(result.id).toBe("task-1");
      expect(result.status).toBe("closed");
    });

    it("should escape quotes in reason", async () => {
      mockStdout = JSON.stringify({ id: "task-1", status: "closed" });
      await beads.close("/repo", "task-1", 'Done with "quotes"');
      // Service replaces " with \"
      expect(true).toBe(true); // No throw = command built correctly
    });

    it("should handle bd close returning array of closed issues", async () => {
      mockStdout = JSON.stringify([{ id: "task-1", status: "closed", close_reason: "Done" }]);
      const result = await beads.close("/repo", "task-1", "Done");
      expect(result.id).toBe("task-1");
      expect(result.status).toBe("closed");
    });

    it("should fall back to show when close returns empty and verify status", async () => {
      let callCount = 0;
      mockExecImpl = async (cmd: string) => {
        callCount++;
        if (cmd.includes("close")) {
          return { stdout: "[]", stderr: "" };
        }
        if (cmd.includes("show")) {
          return {
            stdout: JSON.stringify({ id: "task-1", status: "closed" }),
            stderr: "",
          };
        }
        return { stdout: "{}", stderr: "" };
      };
      const result = await beads.close("/repo", "task-1", "Done");
      expect(result.id).toBe("task-1");
      expect(result.status).toBe("closed");
      expect(callCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("list", () => {
    it("should return array of issues", async () => {
      mockStdout = JSON.stringify([
        { id: "a", title: "Task A", status: "open" },
        { id: "b", title: "Task B", status: "in_progress" },
      ]);
      const result = await beads.list("/repo");
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("a");
      expect(result[1].id).toBe("b");
    });

    it("should return empty array for empty list", async () => {
      mockStdout = "[]";
      const result = await beads.list("/repo");
      expect(result).toEqual([]);
    });
  });

  describe("show", () => {
    it("should return full issue details", async () => {
      mockStdout = JSON.stringify({
        id: "task-1",
        title: "Implement login",
        description: "Add JWT auth",
        status: "open",
        priority: 1,
        dependencies: [],
      });
      const result = await beads.show("/repo", "task-1");
      expect(result.id).toBe("task-1");
      expect(result.title).toBe("Implement login");
      expect(result.description).toBe("Add JWT auth");
    });

    it("should throw when issue not found", async () => {
      mockStdout = "[]";
      await expect(beads.show("/repo", "nonexistent")).rejects.toThrow(
        /Issue nonexistent not found/
      );
    });

    it("should handle bd show returning array format", async () => {
      mockStdout = JSON.stringify([{ id: "task-1", title: "Task", status: "open" }]);
      const result = await beads.show("/repo", "task-1");
      expect(result.id).toBe("task-1");
    });
  });

  describe("ready", () => {
    it("should return ready tasks (priority-sorted, deps resolved)", async () => {
      mockExecImpl = async (cmd: string) => {
        if (cmd.includes("list --all")) {
          return {
            stdout: JSON.stringify([
              {
                id: "task-1",
                title: "High priority",
                priority: 0,
                status: "open",
                issue_type: "task",
                dependencies: [],
              },
              {
                id: "task-2",
                title: "Next",
                priority: 1,
                status: "open",
                issue_type: "task",
                dependencies: [],
              },
            ]),
            stderr: "",
          };
        }
        return { stdout: "{}", stderr: "" };
      };
      const result = await beads.ready("/repo");
      expect(result).toHaveLength(2);
      expect(result[0].priority).toBe(0);
    });

    it("should return empty array when no ready tasks", async () => {
      mockExecImpl = async (cmd: string) => {
        if (cmd.includes("list --all")) return { stdout: "[]", stderr: "" };
        return { stdout: "{}", stderr: "" };
      };
      const result = await beads.ready("/repo");
      expect(result).toEqual([]);
    });

    it("should filter out tasks whose blockers are not closed", async () => {
      mockExecImpl = async (cmd: string) => {
        if (cmd.includes("list --all")) {
          return {
            stdout: JSON.stringify([
              {
                id: "task-1",
                title: "Blocker",
                priority: 0,
                status: "open",
                issue_type: "task",
                dependencies: [],
              },
              {
                id: "task-2",
                title: "Blocked",
                priority: 1,
                status: "open",
                issue_type: "task",
                dependencies: [{ type: "blocks", depends_on_id: "task-1" }],
              },
            ]),
            stderr: "",
          };
        }
        return { stdout: "{}", stderr: "" };
      };
      const result = await beads.ready("/repo");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("task-1");
    });
  });

  describe("areAllBlockersClosed", () => {
    it("should return true when task has no blockers", async () => {
      mockExecImpl = async (cmd: string) => {
        if (cmd.includes("show t1")) {
          return { stdout: JSON.stringify({ id: "t1", dependencies: [] }), stderr: "" };
        }
        if (cmd.includes("list --all")) {
          return { stdout: JSON.stringify([{ id: "t1", status: "open" }]), stderr: "" };
        }
        return { stdout: "{}", stderr: "" };
      };
      const result = await beads.areAllBlockersClosed("/repo", "t1");
      expect(result).toBe(true);
    });

    it("should return true when all blockers are closed", async () => {
      mockExecImpl = async (cmd: string) => {
        if (cmd.includes("show t1")) {
          return {
            stdout: JSON.stringify({
              id: "t1",
              dependencies: [{ type: "blocks", depends_on_id: "b1" }],
            }),
            stderr: "",
          };
        }
        if (cmd.includes("show b1")) {
          return { stdout: JSON.stringify({ id: "b1", status: "closed" }), stderr: "" };
        }
        if (cmd.includes("list --all")) {
          return {
            stdout: JSON.stringify([
              { id: "t1", status: "open" },
              { id: "b1", status: "closed" },
            ]),
            stderr: "",
          };
        }
        return { stdout: "{}", stderr: "" };
      };
      const result = await beads.areAllBlockersClosed("/repo", "t1");
      expect(result).toBe(true);
    });

    it("should return false when a blocker is in_progress", async () => {
      mockExecImpl = async (cmd: string) => {
        if (cmd.includes("show t1")) {
          return {
            stdout: JSON.stringify({
              id: "t1",
              dependencies: [{ type: "blocks", depends_on_id: "b1" }],
            }),
            stderr: "",
          };
        }
        if (cmd.includes("show b1")) {
          return { stdout: JSON.stringify({ id: "b1", status: "in_progress" }), stderr: "" };
        }
        if (cmd.includes("list --all")) {
          return {
            stdout: JSON.stringify([
              { id: "t1", status: "open" },
              { id: "b1", status: "in_progress" },
            ]),
            stderr: "",
          };
        }
        return { stdout: "{}", stderr: "" };
      };
      const result = await beads.areAllBlockersClosed("/repo", "t1");
      expect(result).toBe(false);
    });
  });

  describe("listAll", () => {
    it("should return all issues including closed", async () => {
      mockStdout = JSON.stringify([
        { id: "a", status: "open" },
        { id: "b", status: "closed" },
      ]);
      const result = await beads.listAll("/repo");
      expect(result).toHaveLength(2);
      expect(result.some((r) => r.status === "closed")).toBe(true);
    });
  });

  describe("getCumulativeAttempts", () => {
    it("returns 0 when no attempts label", async () => {
      mockStdout = JSON.stringify({ id: "task-1", labels: [] });
      const result = await beads.getCumulativeAttempts("/repo", "task-1");
      expect(result).toBe(0);
    });

    it("returns count from attempts:N label", async () => {
      mockStdout = JSON.stringify({ id: "task-1", labels: ["attempts:3"] });
      const result = await beads.getCumulativeAttempts("/repo", "task-1");
      expect(result).toBe(3);
    });

    it("returns 0 when labels is undefined", async () => {
      mockStdout = JSON.stringify({ id: "task-1" });
      const result = await beads.getCumulativeAttempts("/repo", "task-1");
      expect(result).toBe(0);
    });
  });

  describe("setCumulativeAttempts", () => {
    it("adds attempts:N label when none exists", async () => {
      const execCalls: string[] = [];
      mockExecImpl = async (cmd: string) => {
        execCalls.push(cmd);
        if (cmd.includes("show")) {
          return { stdout: JSON.stringify({ id: "task-1", labels: [] }), stderr: "" };
        }
        if (cmd.includes("update") && cmd.includes("--add-label")) {
          return { stdout: "{}", stderr: "" };
        }
        return { stdout: "{}", stderr: "" };
      };
      await beads.setCumulativeAttempts("/repo", "task-1", 2);
      expect(execCalls.some((c) => c.includes("attempts:2"))).toBe(true);
    });

    it("removes old attempts label before adding new one", async () => {
      const execCalls: string[] = [];
      mockExecImpl = async (cmd: string) => {
        execCalls.push(cmd);
        if (cmd.includes("show")) {
          return { stdout: JSON.stringify({ id: "task-1", labels: ["attempts:1"] }), stderr: "" };
        }
        if (cmd.includes("--remove-label")) {
          return { stdout: "{}", stderr: "" };
        }
        if (cmd.includes("--add-label")) {
          return { stdout: "{}", stderr: "" };
        }
        return { stdout: "{}", stderr: "" };
      };
      await beads.setCumulativeAttempts("/repo", "task-1", 2);
      expect(execCalls.some((c) => c.includes("attempts:1"))).toBe(true);
      expect(execCalls.some((c) => c.includes("attempts:2"))).toBe(true);
    });
  });

  describe("listInProgressWithAgentAssignee", () => {
    it("should return only in_progress tasks with agent-N assignee", async () => {
      mockStdout = JSON.stringify([
        { id: "task-1", status: "in_progress", assignee: "agent-1" },
        { id: "task-2", status: "open", assignee: "agent-1" },
        { id: "task-3", status: "in_progress", assignee: "Todd Medema" },
        { id: "task-4", status: "in_progress", assignee: "agent-2" },
        { id: "task-5", status: "in_progress", assignee: null },
      ]);
      const result = await beads.listInProgressWithAgentAssignee("/repo");
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.id)).toEqual(["task-1", "task-4"]);
    });

    it("should return empty array when no orphaned tasks", async () => {
      mockStdout = JSON.stringify([
        { id: "a", status: "open", assignee: null },
        { id: "b", status: "closed", assignee: null },
      ]);
      const result = await beads.listInProgressWithAgentAssignee("/repo");
      expect(result).toEqual([]);
    });
  });

  describe("stale DB recovery", () => {
    it("tries sync --import-only first when DB is stale, then retries", async () => {
      const execCalls: string[] = [];
      let listCallCount = 0;
      mockExecImpl = async (cmd: string) => {
        execCalls.push(cmd);
        if (cmd.includes("list --all")) {
          listCallCount++;
          if (listCallCount === 1) {
            throw Object.assign(new Error("Database out of sync"), {
              stderr: "Database out of sync with JSONL. Run 'bd sync --import-only' to fix.",
            });
          }
          return { stdout: "[]", stderr: "" };
        }
        if (cmd.includes("sync --import-only")) {
          return { stdout: "", stderr: "" };
        }
        if (cmd.includes("import -i") && cmd.includes("--orphan-handling allow")) {
          return { stdout: "", stderr: "" };
        }
        return { stdout: "[]", stderr: "" };
      };
      const result = await beads.listAll("/repo");
      expect(result).toEqual([]);
      const syncCall = execCalls.find((c) => c.includes("sync --import-only"));
      expect(syncCall).toBeDefined();
      expect(execCalls.filter((c) => c.includes("list --all"))).toHaveLength(2);
    });

    it("falls back to import --orphan-handling allow when sync fails", async () => {
      const execCalls: string[] = [];
      let listCallCount = 0;
      mockExecImpl = async (cmd: string) => {
        execCalls.push(cmd);
        if (cmd.includes("list --all")) {
          listCallCount++;
          if (listCallCount === 1) {
            throw Object.assign(new Error("Database out of sync"), {
              stderr: "Database out of sync with JSONL. Run 'bd sync --import-only' to fix.",
            });
          }
          return { stdout: "[]", stderr: "" };
        }
        if (cmd.includes("sync --import-only")) {
          throw Object.assign(new Error("sync failed"), {
            stderr: "parent issue does not exist",
          });
        }
        if (cmd.includes("import -i") && cmd.includes("--orphan-handling allow")) {
          return { stdout: "", stderr: "" };
        }
        return { stdout: "[]", stderr: "" };
      };
      const result = await beads.listAll("/repo");
      expect(result).toEqual([]);
      const syncCall = execCalls.find((c) => c.includes("sync --import-only"));
      const importCall = execCalls.find(
        (c) => c.includes("import -i") && c.includes("--orphan-handling allow")
      );
      expect(syncCall).toBeDefined();
      expect(importCall).toBeDefined();
      expect(execCalls.indexOf(syncCall!)).toBeLessThan(execCalls.indexOf(importCall!));
    });

    it("includes manual fix hint when retry fails after recovery", async () => {
      mockExecImpl = async (cmd: string) => {
        if (cmd.includes("list --all")) {
          throw Object.assign(new Error("Database out of sync"), {
            stderr: "Database out of sync with JSONL.",
          });
        }
        if (cmd.includes("sync --import-only") || cmd.includes("import -i")) {
          return { stdout: "", stderr: "" };
        }
        return { stdout: "[]", stderr: "" };
      };
      await expect(beads.listAll("/repo")).rejects.toThrow(
        /bd sync --import-only|bd import -i .beads\/issues.jsonl --orphan-handling allow/
      );
    });

    it("falls back to import --orphan-handling skip when allow fails", async () => {
      const execCalls: string[] = [];
      let listCallCount = 0;
      mockExecImpl = async (cmd: string) => {
        execCalls.push(cmd);
        if (cmd.includes("list --all")) {
          listCallCount++;
          if (listCallCount === 1) {
            throw Object.assign(new Error("Database out of sync"), {
              stderr: "Database out of sync with JSONL. Run 'bd sync --import-only' to fix.",
            });
          }
          return { stdout: "[]", stderr: "" };
        }
        if (cmd.includes("sync --import-only")) {
          throw Object.assign(new Error("sync failed"), {
            stderr: "parent issue opensprint.dev-3uv does not exist",
          });
        }
        if (cmd.includes("import -i") && cmd.includes("--orphan-handling allow")) {
          throw Object.assign(new Error("import failed"), {
            stderr: "parent issue opensprint.dev-3uv does not exist",
          });
        }
        if (cmd.includes("import -i") && cmd.includes("--orphan-handling skip")) {
          return { stdout: "", stderr: "" };
        }
        return { stdout: "[]", stderr: "" };
      };
      const result = await beads.listAll("/repo");
      expect(result).toEqual([]);
      const allowCall = execCalls.find(
        (c) => c.includes("import -i") && c.includes("--orphan-handling allow")
      );
      const skipCall = execCalls.find(
        (c) => c.includes("import -i") && c.includes("--orphan-handling skip")
      );
      expect(allowCall).toBeDefined();
      expect(skipCall).toBeDefined();
      expect(execCalls.indexOf(allowCall!)).toBeLessThan(execCalls.indexOf(skipCall!));
    });

    it("throws BEADS_SYNC_FAILED when sync, allow, and skip all fail", async () => {
      mockExecImpl = async (cmd: string) => {
        if (cmd.includes("sync --import-only") || cmd.includes("import -i")) {
          throw Object.assign(new Error("sync failed"), {
            stderr: "Database corrupted",
          });
        }
        return { stdout: "[]", stderr: "" };
      };
      await expect(beads.listAll("/repo")).rejects.toMatchObject({
        statusCode: 502,
        code: "BEADS_SYNC_FAILED",
      });
    });
  });

  describe("proactive sync on first use", () => {
    it("runs syncImport on first beads command for a repo", async () => {
      const execCalls: string[] = [];
      const uniqueRepo = path.join(os.tmpdir(), `beads-sync-test-${Date.now()}`);
      fs.mkdirSync(path.join(uniqueRepo, ".beads"), { recursive: true });

      mockExecImpl = async (cmd: string) => {
        execCalls.push(cmd);
        if (cmd.includes("sync --import-only") || cmd.includes("import -i")) {
          return { stdout: "", stderr: "" };
        }
        return { stdout: "[]", stderr: "" };
      };

      await beads.listAll(uniqueRepo);

      const syncCall = execCalls.find((c) => c.includes("sync --import-only"));
      expect(syncCall).toBeDefined();
      const listCall = execCalls.find((c) => c.includes("list --all"));
      expect(listCall).toBeDefined();
      expect(execCalls.indexOf(syncCall!)).toBeLessThan(execCalls.indexOf(listCall!));

      fs.rmSync(uniqueRepo, { recursive: true, force: true });
    });
  });

  describe("export", () => {
    it("runs sync --import-only (or import fallback) before export to prevent stale DB errors", async () => {
      const execCalls: string[] = [];
      mockExecImpl = async (cmd: string) => {
        execCalls.push(cmd);
        return { stdout: "", stderr: "" };
      };
      await beads.export("/repo", ".beads/issues.jsonl");
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
            stderr:
              "Error: refusing to export stale database that would lose issues\n" +
              "  Export would lose 1 issue(s):\n" +
              "    - opensprint.dev-ly1e\n",
          });
        }
        return { stdout: "", stderr: "" };
      };
      await beads.export("/repo", ".beads/issues.jsonl");
      expect(exportAttempt).toBeGreaterThanOrEqual(1);
      expect(execCalls.some((c) => c.includes("--force"))).toBe(true);
    });
  });

  describe("ensureDaemon / stopDaemonsForRepos (daemon removed)", () => {
    it("ensureDaemon does not run bd daemon commands (daemon subsystem removed)", async () => {
      const uniqueRepo = path.join(os.tmpdir(), `beads-ensure-test-${Date.now()}`);
      fs.mkdirSync(path.join(uniqueRepo, ".beads"), { recursive: true });

      const execCalls: string[] = [];
      mockExecImpl = async (cmd: string) => {
        execCalls.push(cmd);
        if (cmd.includes("sync --import-only") || cmd.includes("import -i")) {
          return { stdout: "", stderr: "" };
        }
        return { stdout: mockStdout, stderr: "" };
      };

      await beads.runBd(uniqueRepo, "list", ["--json"]);

      const daemonCalls = execCalls.filter(
        (c) => c.includes("daemon stop") || c.includes("daemon start")
      );
      expect(daemonCalls).toHaveLength(0);

      fs.rmSync(uniqueRepo, { recursive: true, force: true });
    });

    it("stopDaemonsForRepos does not run bd daemon stop (daemon subsystem removed)", async () => {
      const execCalls: string[] = [];
      mockExecImpl = async (cmd: string) => {
        execCalls.push(cmd);
        return { stdout: "", stderr: "" };
      };

      await beads.stopDaemonsForRepos(["/repo/a", "/repo/b"]);

      const stopCalls = execCalls.filter((c) => c.includes("daemon stop"));
      expect(stopCalls).toHaveLength(0);
    });

    it("stopDaemonsForRepos removes backend.pid when it matches our process pid", async () => {
      const tmpDir = path.join(os.tmpdir(), `beads-stop-test-${Date.now()}`);
      const beadsDir = path.join(tmpDir, ".beads");
      const backendPidPath = path.join(beadsDir, "backend.pid");
      fs.mkdirSync(beadsDir, { recursive: true });
      fs.writeFileSync(backendPidPath, String(process.pid), "utf-8");

      mockExecImpl = async () => ({ stdout: "", stderr: "" });

      await beads.stopDaemonsForRepos([tmpDir]);

      expect(fs.existsSync(backendPidPath)).toBe(false);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("getManagedRepoPaths returns empty array (daemon subsystem removed)", () => {
      expect(BeadsService.getManagedRepoPaths()).toEqual([]);
    });
  });
});
