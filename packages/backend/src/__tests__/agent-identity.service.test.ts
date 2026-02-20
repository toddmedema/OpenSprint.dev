import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  AgentIdentityService,
  type TaskAttemptRecord,
} from "../services/agent-identity.service.js";
import type { ProjectSettings } from "@opensprint/shared";

describe("AgentIdentityService", () => {
  let tmpDir: string;
  let service: AgentIdentityService;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `agent-identity-test-${Date.now()}`);
    await fs.mkdir(path.join(tmpDir, ".opensprint"), { recursive: true });
    service = new AgentIdentityService();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  function makeRecord(overrides: Partial<TaskAttemptRecord> = {}): TaskAttemptRecord {
    return {
      taskId: "task-1",
      agentId: "claude-sonnet",
      model: "claude-sonnet-4-20250514",
      attempt: 1,
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: "2025-01-01T00:01:00.000Z",
      outcome: "success",
      durationMs: 60000,
      ...overrides,
    };
  }

  it("should record and retrieve attempt records", async () => {
    await service.recordAttempt(tmpDir, makeRecord());
    await service.recordAttempt(tmpDir, makeRecord({ attempt: 2, outcome: "test_failure" }));

    const recent = await service.getRecentAttempts(tmpDir, "task-1");
    expect(recent).toHaveLength(2);
    expect(recent[0].outcome).toBe("success");
    expect(recent[1].outcome).toBe("test_failure");
  });

  it("should persist stats to disk", async () => {
    await service.recordAttempt(tmpDir, makeRecord());

    const statsPath = path.join(tmpDir, ".opensprint/agent-stats.json");
    const raw = await fs.readFile(statsPath, "utf-8");
    const data = JSON.parse(raw);
    expect(data.attempts).toHaveLength(1);
    expect(data.attempts[0].taskId).toBe("task-1");
  });

  it("should load stats from disk (survives restart)", async () => {
    await service.recordAttempt(tmpDir, makeRecord());

    // Create a new service instance to simulate restart
    const service2 = new AgentIdentityService();
    await service2.recordAttempt(tmpDir, makeRecord({ attempt: 2 }));

    const recent = await service2.getRecentAttempts(tmpDir, "task-1");
    expect(recent).toHaveLength(2);
  });

  it("should build agent profile with aggregated stats", async () => {
    await service.recordAttempt(tmpDir, makeRecord({ outcome: "success", durationMs: 30000 }));
    await service.recordAttempt(
      tmpDir,
      makeRecord({ attempt: 2, outcome: "success", durationMs: 60000, taskId: "task-2" })
    );
    await service.recordAttempt(
      tmpDir,
      makeRecord({ attempt: 3, outcome: "test_failure", durationMs: 45000, taskId: "task-3" })
    );

    const profile = await service.getProfile(tmpDir, "claude-sonnet");
    expect(profile.stats.tasksAttempted).toBe(3);
    expect(profile.stats.tasksSucceeded).toBe(2);
    expect(profile.stats.tasksFailed).toBe(1);
    expect(profile.stats.avgTimeToComplete).toBe(45000); // (30000+60000)/2
    expect(profile.stats.failuresByType).toEqual({ test_failure: 1 });
  });

  it("should cap stored records at 500", async () => {
    for (let i = 0; i < 510; i++) {
      await service.recordAttempt(tmpDir, makeRecord({ attempt: i, taskId: `task-${i}` }));
    }

    const statsPath = path.join(tmpDir, ".opensprint/agent-stats.json");
    const raw = await fs.readFile(statsPath, "utf-8");
    const data = JSON.parse(raw);
    expect(data.attempts.length).toBeLessThanOrEqual(500);
  });

  describe("selectAgentForRetry", () => {
    const baseSettings = {
      codingAgent: { type: "claude" as const, model: "claude-sonnet-4-20250514", cliCommand: null },
      planningAgent: {
        type: "claude" as const,
        model: "claude-sonnet-4-20250514",
        cliCommand: null,
      },
      reviewMode: "always" as const,
      deployment: { mode: "custom" as const },
    };

    it("should use base config for first 2 attempts", () => {
      const config = service.selectAgentForRetry(
        baseSettings as unknown as ProjectSettings,
        "task-1",
        1,
        "test_failure",
        undefined,
        []
      );
      expect(config.model).toBe("claude-sonnet-4-20250514");

      const config2 = service.selectAgentForRetry(
        baseSettings as unknown as ProjectSettings,
        "task-1",
        2,
        "test_failure",
        undefined,
        []
      );
      expect(config2.model).toBe("claude-sonnet-4-20250514");
    });

    it("should escalate model on 3+ consecutive same-type failures", () => {
      const attempts: TaskAttemptRecord[] = [
        makeRecord({ attempt: 1, outcome: "test_failure" }),
        makeRecord({ attempt: 2, outcome: "test_failure" }),
        makeRecord({ attempt: 3, outcome: "test_failure" }),
      ];

      const config = service.selectAgentForRetry(
        baseSettings as unknown as ProjectSettings,
        "task-1",
        4,
        "test_failure",
        undefined,
        attempts
      );
      expect(config.model).toContain("opus");
    });

    it("should not escalate when failure types differ", () => {
      const attempts: TaskAttemptRecord[] = [
        makeRecord({ attempt: 1, outcome: "test_failure" }),
        makeRecord({ attempt: 2, outcome: "review_rejection" }),
        makeRecord({ attempt: 3, outcome: "test_failure" }),
      ];

      const config = service.selectAgentForRetry(
        baseSettings as unknown as ProjectSettings,
        "task-1",
        4,
        "test_failure",
        undefined,
        attempts
      );
      // Last consecutive same-type count is 1 (only the most recent), so no escalation
      expect(config.model).toBe("claude-sonnet-4-20250514");
    });
  });
});
