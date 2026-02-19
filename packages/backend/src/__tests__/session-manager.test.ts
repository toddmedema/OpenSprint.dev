import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SessionManager } from "../services/session-manager.js";
import { OPENSPRINT_PATHS } from "@opensprint/shared";

describe("SessionManager", () => {
  let manager: SessionManager;
  let repoPath: string;

  beforeEach(async () => {
    manager = new SessionManager();
    repoPath = path.join(os.tmpdir(), `opensprint-session-test-${Date.now()}`);
    await fs.mkdir(repoPath, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(repoPath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("loadSessionsGroupedByTaskId", () => {
    it("returns empty map when sessions directory does not exist", async () => {
      const result = await manager.loadSessionsGroupedByTaskId(repoPath);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it("returns empty map when sessions directory is empty", async () => {
      const sessionsDir = path.join(repoPath, OPENSPRINT_PATHS.sessions);
      await fs.mkdir(sessionsDir, { recursive: true });
      const result = await manager.loadSessionsGroupedByTaskId(repoPath);
      expect(result.size).toBe(0);
    });

    it("groups sessions by task ID with single readdir", async () => {
      const sessionsDir = path.join(repoPath, OPENSPRINT_PATHS.sessions);
      await fs.mkdir(sessionsDir, { recursive: true });

      await fs.mkdir(path.join(sessionsDir, "task-a-1"), { recursive: true });
      await fs.writeFile(
        path.join(sessionsDir, "task-a-1", "session.json"),
        JSON.stringify({
          taskId: "task-a",
          attempt: 1,
          agentType: "cursor",
          agentModel: "gpt-4",
          startedAt: "2024-01-01T00:00:00Z",
          completedAt: "2024-01-01T00:05:00Z",
          status: "success",
          outputLog: "",
          gitBranch: "main",
          gitDiff: null,
          testResults: { passed: 5, failed: 0, skipped: 0, total: 5, details: [] },
          failureReason: null,
        })
      );

      await fs.mkdir(path.join(sessionsDir, "task-a-2"), { recursive: true });
      await fs.writeFile(
        path.join(sessionsDir, "task-a-2", "session.json"),
        JSON.stringify({
          taskId: "task-a",
          attempt: 2,
          agentType: "cursor",
          agentModel: "gpt-4",
          startedAt: "2024-01-02T00:00:00Z",
          completedAt: "2024-01-02T00:05:00Z",
          status: "success",
          outputLog: "",
          gitBranch: "main",
          gitDiff: null,
          testResults: { passed: 6, failed: 0, skipped: 0, total: 6, details: [] },
          failureReason: null,
        })
      );

      await fs.mkdir(path.join(sessionsDir, "task-b-1"), { recursive: true });
      await fs.writeFile(
        path.join(sessionsDir, "task-b-1", "session.json"),
        JSON.stringify({
          taskId: "task-b",
          attempt: 1,
          agentType: "cursor",
          agentModel: "gpt-4",
          startedAt: "2024-01-03T00:00:00Z",
          completedAt: "2024-01-03T00:05:00Z",
          status: "success",
          outputLog: "",
          gitBranch: "main",
          gitDiff: null,
          testResults: null,
          failureReason: null,
        })
      );

      const result = await manager.loadSessionsGroupedByTaskId(repoPath);
      expect(result.size).toBe(2);
      expect(result.get("task-a")).toHaveLength(2);
      expect(result.get("task-a")![0].attempt).toBe(1);
      expect(result.get("task-a")![1].attempt).toBe(2);
      expect(result.get("task-a")![1].testResults?.passed).toBe(6);
      expect(result.get("task-b")).toHaveLength(1);
    });

    it("parses task IDs with hyphens correctly (e.g. opensprint.dev-q0h6-1)", async () => {
      const sessionsDir = path.join(repoPath, OPENSPRINT_PATHS.sessions);
      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.mkdir(path.join(sessionsDir, "opensprint.dev-q0h6-1"), { recursive: true });
      await fs.writeFile(
        path.join(sessionsDir, "opensprint.dev-q0h6-1", "session.json"),
        JSON.stringify({
          taskId: "opensprint.dev-q0h6",
          attempt: 1,
          agentType: "cursor",
          agentModel: "gpt-4",
          startedAt: "2024-01-01T00:00:00Z",
          completedAt: "2024-01-01T00:05:00Z",
          status: "success",
          outputLog: "",
          gitBranch: "main",
          gitDiff: null,
          testResults: null,
          failureReason: null,
        })
      );

      const result = await manager.loadSessionsGroupedByTaskId(repoPath);
      expect(result.size).toBe(1);
      expect(result.get("opensprint.dev-q0h6")).toHaveLength(1);
      expect(result.get("opensprint.dev-q0h6")![0].attempt).toBe(1);
    });

    it("skips entries that do not match taskId-attempt format", async () => {
      const sessionsDir = path.join(repoPath, OPENSPRINT_PATHS.sessions);
      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.mkdir(path.join(sessionsDir, "valid-task-1"), { recursive: true });
      await fs.writeFile(
        path.join(sessionsDir, "valid-task-1", "session.json"),
        JSON.stringify({
          taskId: "valid-task",
          attempt: 1,
          agentType: "cursor",
          agentModel: "gpt-4",
          startedAt: "2024-01-01T00:00:00Z",
          completedAt: null,
          status: "success",
          outputLog: "",
          gitBranch: "main",
          gitDiff: null,
          testResults: null,
          failureReason: null,
        })
      );
      await fs.writeFile(path.join(sessionsDir, "random-file.txt"), "ignore");
      await fs.mkdir(path.join(sessionsDir, "no-hyphen"), { recursive: true });

      const result = await manager.loadSessionsGroupedByTaskId(repoPath);
      expect(result.size).toBe(1);
      expect(result.get("valid-task")).toHaveLength(1);
    });

    it("skips broken session.json files", async () => {
      const sessionsDir = path.join(repoPath, OPENSPRINT_PATHS.sessions);
      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.mkdir(path.join(sessionsDir, "task-1"), { recursive: true });
      await fs.writeFile(path.join(sessionsDir, "task-1", "session.json"), "not valid json");
      await fs.mkdir(path.join(sessionsDir, "task-2"), { recursive: true });
      await fs.writeFile(
        path.join(sessionsDir, "task-2", "session.json"),
        JSON.stringify({
          taskId: "task",
          attempt: 2,
          agentType: "cursor",
          agentModel: "gpt-4",
          startedAt: "2024-01-01T00:00:00Z",
          completedAt: null,
          status: "success",
          outputLog: "",
          gitBranch: "main",
          gitDiff: null,
          testResults: null,
          failureReason: null,
        })
      );

      const result = await manager.loadSessionsGroupedByTaskId(repoPath);
      expect(result.size).toBe(1);
      expect(result.get("task")).toHaveLength(1);
      expect(result.get("task")![0].attempt).toBe(2);
    });
  });

  describe("listSessions", () => {
    it("returns sessions for a task in attempt order", async () => {
      const sessionsDir = path.join(repoPath, OPENSPRINT_PATHS.sessions);
      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.mkdir(path.join(sessionsDir, "my-task-2"), { recursive: true });
      await fs.writeFile(
        path.join(sessionsDir, "my-task-2", "session.json"),
        JSON.stringify({
          taskId: "my-task",
          attempt: 2,
          agentType: "cursor",
          agentModel: "gpt-4",
          startedAt: "2024-01-02T00:00:00Z",
          completedAt: null,
          status: "success",
          outputLog: "",
          gitBranch: "main",
          gitDiff: null,
          testResults: null,
          failureReason: null,
        })
      );
      await fs.mkdir(path.join(sessionsDir, "my-task-1"), { recursive: true });
      await fs.writeFile(
        path.join(sessionsDir, "my-task-1", "session.json"),
        JSON.stringify({
          taskId: "my-task",
          attempt: 1,
          agentType: "cursor",
          agentModel: "gpt-4",
          startedAt: "2024-01-01T00:00:00Z",
          completedAt: null,
          status: "success",
          outputLog: "",
          gitBranch: "main",
          gitDiff: null,
          testResults: null,
          failureReason: null,
        })
      );

      const sessions = await manager.listSessions(repoPath, "my-task");
      expect(sessions).toHaveLength(2);
      expect(sessions[0].attempt).toBe(1);
      expect(sessions[1].attempt).toBe(2);
    });
  });
});
