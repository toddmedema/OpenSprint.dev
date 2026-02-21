import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { CrashRecoveryService } from "../services/crash-recovery.service.js";
import type { TaskAssignment } from "../services/orchestrator.service.js";

vi.mock("../services/active-agents.service.js", () => ({
  activeAgentsService: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

vi.mock("../services/heartbeat.service.js", () => ({
  heartbeatService: {
    readHeartbeat: vi.fn().mockResolvedValue(null),
    deleteHeartbeat: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../websocket/index.js", () => ({
  broadcastToProject: vi.fn(),
  sendAgentOutputToProject: vi.fn(),
}));

vi.mock("../services/event-log.service.js", () => ({
  eventLogService: {
    append: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("CrashRecoveryService — GUPP pattern", () => {
  let tmpDir: string;
  let service: CrashRecoveryService;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `crash-gupp-test-${Date.now()}`);
    await fs.mkdir(path.join(tmpDir, ".opensprint", "active"), { recursive: true });
    service = new CrashRecoveryService();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("findOrphanedAssignments", () => {
    it("should find assignment.json files in active directories", async () => {
      const taskDir = path.join(tmpDir, ".opensprint", "active", "task-1");
      await fs.mkdir(taskDir, { recursive: true });

      const assignment: TaskAssignment = {
        taskId: "task-1",
        projectId: "proj-1",
        phase: "coding",
        branchName: "opensprint/task-1",
        worktreePath: "/tmp/wt",
        promptPath: "/tmp/wt/.opensprint/active/task-1/prompt.md",
        agentConfig: { type: "claude", model: "claude-sonnet-4-20250514", cliCommand: null },
        attempt: 1,
        createdAt: "2025-01-01T00:00:00.000Z",
      };
      await fs.writeFile(path.join(taskDir, "assignment.json"), JSON.stringify(assignment));

      const orphaned = await service.findOrphanedAssignments(tmpDir);
      expect(orphaned).toHaveLength(1);
      expect(orphaned[0].taskId).toBe("task-1");
      expect(orphaned[0].assignment.phase).toBe("coding");
      expect(orphaned[0].assignment.attempt).toBe(1);
    });

    it("should skip directories without assignment.json", async () => {
      const taskDir1 = path.join(tmpDir, ".opensprint", "active", "task-1");
      const taskDir2 = path.join(tmpDir, ".opensprint", "active", "task-2");
      await fs.mkdir(taskDir1, { recursive: true });
      await fs.mkdir(taskDir2, { recursive: true });

      // Only task-1 has an assignment
      await fs.writeFile(
        path.join(taskDir1, "assignment.json"),
        JSON.stringify({
          taskId: "task-1",
          projectId: "proj-1",
          phase: "coding",
          branchName: "opensprint/task-1",
          worktreePath: "/tmp/wt",
          promptPath: "/tmp/wt/prompt.md",
          agentConfig: { type: "claude", model: null, cliCommand: null },
          attempt: 1,
          createdAt: new Date().toISOString(),
        })
      );

      const orphaned = await service.findOrphanedAssignments(tmpDir);
      expect(orphaned).toHaveLength(1);
      expect(orphaned[0].taskId).toBe("task-1");
    });

    it("should skip directories starting with underscore", async () => {
      const mergerDir = path.join(tmpDir, ".opensprint", "active", "_merger");
      await fs.mkdir(mergerDir, { recursive: true });
      await fs.writeFile(
        path.join(mergerDir, "assignment.json"),
        JSON.stringify({ taskId: "_merger" })
      );

      const orphaned = await service.findOrphanedAssignments(tmpDir);
      expect(orphaned).toHaveLength(0);
    });

    it("should return empty when no active directory exists", async () => {
      const emptyDir = path.join(os.tmpdir(), `empty-${Date.now()}`);
      await fs.mkdir(emptyDir, { recursive: true });

      const orphaned = await service.findOrphanedAssignments(emptyDir);
      expect(orphaned).toEqual([]);

      await fs.rm(emptyDir, { recursive: true, force: true }).catch(() => {});
    });

    it("should handle multiple orphaned assignments", async () => {
      for (let i = 1; i <= 3; i++) {
        const dir = path.join(tmpDir, ".opensprint", "active", `task-${i}`);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(
          path.join(dir, "assignment.json"),
          JSON.stringify({
            taskId: `task-${i}`,
            projectId: "proj-1",
            phase: i === 2 ? "review" : "coding",
            branchName: `opensprint/task-${i}`,
            worktreePath: `/tmp/wt-${i}`,
            promptPath: `/tmp/wt-${i}/prompt.md`,
            agentConfig: { type: "claude", model: null, cliCommand: null },
            attempt: i,
            createdAt: new Date().toISOString(),
          })
        );
      }

      const orphaned = await service.findOrphanedAssignments(tmpDir);
      expect(orphaned).toHaveLength(3);

      const reviewAssignment = orphaned.find((o) => o.taskId === "task-2");
      expect(reviewAssignment?.assignment.phase).toBe("review");
      expect(reviewAssignment?.assignment.attempt).toBe(2);
    });
  });

  describe("findOrphanedAssignmentsFromWorktrees", () => {
    it("should find assignment.json in worktree directories", async () => {
      const worktreeBase = path.join(tmpDir, "worktrees");
      const taskId = "task-1";
      const taskActiveDir = path.join(worktreeBase, taskId, ".opensprint", "active", taskId);
      await fs.mkdir(taskActiveDir, { recursive: true });
      const assignment: TaskAssignment = {
        taskId,
        projectId: "proj-1",
        phase: "coding",
        branchName: "opensprint/task-1",
        worktreePath: path.join(worktreeBase, taskId),
        promptPath: path.join(taskActiveDir, "prompt.md"),
        agentConfig: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
        attempt: 1,
        createdAt: new Date().toISOString(),
      };
      await fs.writeFile(path.join(taskActiveDir, "assignment.json"), JSON.stringify(assignment));

      const orphaned = await service.findOrphanedAssignmentsFromWorktrees(worktreeBase);
      expect(orphaned).toHaveLength(1);
      expect(orphaned[0].taskId).toBe(taskId);
      expect(orphaned[0].assignment.worktreePath).toBe(path.join(worktreeBase, taskId));
    });

    it("should return empty when worktree base does not exist", async () => {
      const orphaned = await service.findOrphanedAssignmentsFromWorktrees(
        path.join(tmpDir, "nonexistent")
      );
      expect(orphaned).toEqual([]);
    });
  });

  describe("deleteAssignmentAt", () => {
    it("should remove assignment.json at given base path", async () => {
      const taskDir = path.join(tmpDir, ".opensprint", "active", "task-1");
      await fs.mkdir(taskDir, { recursive: true });
      await fs.writeFile(
        path.join(taskDir, "assignment.json"),
        JSON.stringify({ taskId: "task-1" })
      );
      await service.deleteAssignmentAt(tmpDir, "task-1");
      await expect(fs.readFile(path.join(taskDir, "assignment.json"))).rejects.toThrow();
    });
  });
});
