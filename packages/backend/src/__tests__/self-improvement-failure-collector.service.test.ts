import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  collectFailuresSince,
  classifyFailureType,
  formatFailuresForPrompt,
  buildFailureReviewSystemSupplement,
  buildFailureReviewUserSupplement,
  type CollectedFailure,
} from "../services/self-improvement-failure-collector.service.js";
import type { OrchestratorEvent } from "../services/event-log.service.js";

vi.mock("../services/event-log.service.js", () => ({
  eventLogService: {
    readSinceByProjectId: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../services/task-store.service.js", () => ({
  taskStore: {
    listAll: vi.fn().mockResolvedValue([]),
    getDb: vi.fn().mockResolvedValue({ query: vi.fn().mockResolvedValue([]) }),
  },
}));

import { eventLogService } from "../services/event-log.service.js";
import { taskStore } from "../services/task-store.service.js";

function makeEvent(overrides: Partial<OrchestratorEvent> & { event: string }): OrchestratorEvent {
  return {
    timestamp: "2026-03-20T12:00:00.000Z",
    projectId: "proj-1",
    taskId: "os-1234",
    data: undefined,
    ...overrides,
  };
}

function makeTask(
  id: string,
  status: string,
  labels: string[] = [],
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    project_id: "proj-1",
    title: `Task ${id}`,
    issue_type: "task",
    status,
    priority: 2,
    labels,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-20T00:00:00.000Z",
    ...extra,
  };
}

describe("classifyFailureType", () => {
  it("classifies merge_conflict as merge", () => {
    expect(classifyFailureType("merge_conflict")).toBe("merge");
  });

  it("classifies merge_quality_gate as quality_gate", () => {
    expect(classifyFailureType("merge_quality_gate")).toBe("quality_gate");
  });

  it("classifies quality_gate as quality_gate", () => {
    expect(classifyFailureType("quality_gate")).toBe("quality_gate");
  });

  it("classifies repo_preflight as environment", () => {
    expect(classifyFailureType("repo_preflight")).toBe("environment");
  });

  it("classifies environment_setup as environment", () => {
    expect(classifyFailureType("environment_setup")).toBe("environment");
  });

  it("classifies test_failure as execution", () => {
    expect(classifyFailureType("test_failure")).toBe("execution");
  });

  it("classifies review_rejection as execution", () => {
    expect(classifyFailureType("review_rejection")).toBe("execution");
  });

  it("classifies agent_crash as execution", () => {
    expect(classifyFailureType("agent_crash")).toBe("execution");
  });

  it("classifies timeout as execution", () => {
    expect(classifyFailureType("timeout")).toBe("execution");
  });

  it("classifies no_result as execution", () => {
    expect(classifyFailureType("no_result")).toBe("execution");
  });

  it("classifies coding_failure as execution", () => {
    expect(classifyFailureType("coding_failure")).toBe("execution");
  });

  it("defaults to execution for unknown types", () => {
    expect(classifyFailureType("something_new")).toBe("execution");
  });

  it("defaults to execution for undefined", () => {
    expect(classifyFailureType(undefined)).toBe("execution");
  });

  it("defaults to execution for null", () => {
    expect(classifyFailureType(null)).toBe("execution");
  });

  it("defaults to execution for empty string", () => {
    expect(classifyFailureType("")).toBe("execution");
  });
});

describe("collectFailuresSince", () => {
  beforeEach(() => {
    vi.mocked(eventLogService.readSinceByProjectId).mockReset().mockResolvedValue([]);
    vi.mocked(taskStore.listAll).mockReset().mockResolvedValue([]);
  });

  it("returns empty array when no events exist", async () => {
    const result = await collectFailuresSince("proj-1", "2026-03-15T00:00:00.000Z");
    expect(result).toEqual([]);
    expect(eventLogService.readSinceByProjectId).toHaveBeenCalledWith(
      "proj-1",
      "2026-03-15T00:00:00.000Z",
    );
  });

  it("returns empty array when events exist but none are failure events", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([
      makeEvent({ event: "task.started" }),
      makeEvent({ event: "task.completed" }),
    ]);
    const result = await collectFailuresSince("proj-1", "2026-03-15T00:00:00.000Z");
    expect(result).toEqual([]);
  });

  it("collects task.failed events with correct classification", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([
      makeEvent({
        event: "task.failed",
        taskId: "os-1234",
        data: {
          failureType: "test_failure",
          attempt: 2,
          summary: "Tests failed in module X",
        },
      }),
    ]);
    vi.mocked(taskStore.listAll).mockResolvedValue([
      makeTask("os-1234", "open", ["attempts:2"]),
    ]);

    const result = await collectFailuresSince("proj-1", "2026-03-15T00:00:00.000Z");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        taskId: "os-1234",
        failureType: "execution",
        rawFailureType: "test_failure",
        attemptCount: 2,
        finalDisposition: "requeued",
        errorSnippet: "Tests failed in module X",
      }),
    );
  });

  it("collects merge.failed events with quality gate details", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([
      makeEvent({
        event: "merge.failed",
        taskId: "os-5678",
        data: {
          failureType: "merge_quality_gate",
          attempt: 1,
          failedGateCommand: "npm run build",
          failedGateOutputSnippet: "TS2345: Argument of type 'string'",
          reason: "Quality gate failed",
        },
      }),
    ]);
    vi.mocked(taskStore.listAll).mockResolvedValue([
      makeTask("os-5678", "blocked", ["attempts:1"]),
    ]);

    const result = await collectFailuresSince("proj-1", "2026-03-15T00:00:00.000Z");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        taskId: "os-5678",
        failureType: "quality_gate",
        rawFailureType: "merge_quality_gate",
        failedCommand: "npm run build",
        errorSnippet: "TS2345: Argument of type 'string'",
        attemptCount: 1,
        finalDisposition: "blocked",
      }),
    );
  });

  it("collects task.blocked events for merge conflicts", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([
      makeEvent({
        event: "task.blocked",
        taskId: "os-9999",
        data: {
          failureType: "merge_conflict",
          attempt: 3,
          summary: "Merge conflict in src/index.ts",
        },
      }),
    ]);
    vi.mocked(taskStore.listAll).mockResolvedValue([
      makeTask("os-9999", "blocked", ["attempts:3"]),
    ]);

    const result = await collectFailuresSince("proj-1", undefined);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        taskId: "os-9999",
        failureType: "merge",
        rawFailureType: "merge_conflict",
        attemptCount: 3,
        finalDisposition: "blocked",
      }),
    );
  });

  it("collects environment failures", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([
      makeEvent({
        event: "task.failed",
        taskId: "os-env1",
        data: {
          failureType: "environment_setup",
          attempt: 1,
          summary: "MODULE_NOT_FOUND: Cannot find module 'react'",
        },
      }),
    ]);
    vi.mocked(taskStore.listAll).mockResolvedValue([
      makeTask("os-env1", "blocked"),
    ]);

    const result = await collectFailuresSince("proj-1", "2026-03-01T00:00:00.000Z");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        taskId: "os-env1",
        failureType: "environment",
        rawFailureType: "environment_setup",
        finalDisposition: "blocked",
      }),
    );
  });

  it("uses all-time window when sinceIso is undefined", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([]);
    await collectFailuresSince("proj-1", undefined);
    expect(eventLogService.readSinceByProjectId).toHaveBeenCalledWith(
      "proj-1",
      "1970-01-01T00:00:00.000Z",
    );
  });

  it("uses all-time window when sinceIso is empty string", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([]);
    await collectFailuresSince("proj-1", "");
    expect(eventLogService.readSinceByProjectId).toHaveBeenCalledWith(
      "proj-1",
      "1970-01-01T00:00:00.000Z",
    );
  });

  it("deduplicates multiple events for the same task, keeping the latest", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([
      makeEvent({
        event: "task.failed",
        taskId: "os-dup",
        timestamp: "2026-03-18T10:00:00.000Z",
        data: { failureType: "test_failure", attempt: 1, summary: "First failure" },
      }),
      makeEvent({
        event: "task.requeued",
        taskId: "os-dup",
        timestamp: "2026-03-18T11:00:00.000Z",
        data: { failureType: "test_failure", attempt: 1, summary: "Requeued" },
      }),
      makeEvent({
        event: "task.blocked",
        taskId: "os-dup",
        timestamp: "2026-03-19T10:00:00.000Z",
        data: { failureType: "test_failure", attempt: 2, summary: "Blocked after retry" },
      }),
    ]);
    vi.mocked(taskStore.listAll).mockResolvedValue([
      makeTask("os-dup", "blocked", ["attempts:2"]),
    ]);

    const result = await collectFailuresSince("proj-1", "2026-03-15T00:00:00.000Z");
    expect(result).toHaveLength(1);
    expect(result[0]!.timestamp).toBe("2026-03-19T10:00:00.000Z");
    expect(result[0]!.attemptCount).toBe(2);
    expect(result[0]!.finalDisposition).toBe("blocked");
  });

  it("handles multiple distinct tasks in the same window", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([
      makeEvent({
        event: "task.failed",
        taskId: "os-a",
        data: { failureType: "test_failure", attempt: 1 },
      }),
      makeEvent({
        event: "merge.failed",
        taskId: "os-b",
        data: { failureType: "merge_conflict", attempt: 2 },
      }),
    ]);
    vi.mocked(taskStore.listAll).mockResolvedValue([
      makeTask("os-a", "open", ["attempts:1"]),
      makeTask("os-b", "blocked", ["attempts:2"]),
    ]);

    const result = await collectFailuresSince("proj-1", "2026-03-15T00:00:00.000Z");
    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.taskId);
    expect(ids).toContain("os-a");
    expect(ids).toContain("os-b");
  });

  it("resolves disposition from task status when task exists", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([
      makeEvent({
        event: "task.failed",
        taskId: "os-closed",
        data: { failureType: "coding_failure", attempt: 1 },
      }),
    ]);
    vi.mocked(taskStore.listAll).mockResolvedValue([
      makeTask("os-closed", "closed"),
    ]);

    const result = await collectFailuresSince("proj-1", "2026-03-15T00:00:00.000Z");
    expect(result).toHaveLength(1);
    expect(result[0]!.finalDisposition).toBe("closed");
  });

  it("falls back to event-based disposition when task not found", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([
      makeEvent({
        event: "task.blocked",
        taskId: "os-gone",
        data: { failureType: "timeout", attempt: 3 },
      }),
    ]);
    vi.mocked(taskStore.listAll).mockResolvedValue([]);

    const result = await collectFailuresSince("proj-1", "2026-03-15T00:00:00.000Z");
    expect(result).toHaveLength(1);
    expect(result[0]!.finalDisposition).toBe("blocked");
  });

  it("returns empty array gracefully when eventLogService throws", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockRejectedValue(
      new Error("DB connection failed"),
    );
    const result = await collectFailuresSince("proj-1", "2026-03-15T00:00:00.000Z");
    expect(result).toEqual([]);
  });

  it("still collects failures when taskStore.listAll throws", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([
      makeEvent({
        event: "task.blocked",
        taskId: "os-x",
        data: { failureType: "agent_crash", attempt: 1 },
      }),
    ]);
    vi.mocked(taskStore.listAll).mockRejectedValue(new Error("DB error"));

    const result = await collectFailuresSince("proj-1", "2026-03-15T00:00:00.000Z");
    expect(result).toHaveLength(1);
    expect(result[0]!.taskId).toBe("os-x");
    expect(result[0]!.finalDisposition).toBe("blocked");
  });

  it("uses cumulativeAttempts from event data when attempt field is missing", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([
      makeEvent({
        event: "task.requeued",
        taskId: "os-cum",
        data: { failureType: "coding_failure", cumulativeAttempts: 5 },
      }),
    ]);
    vi.mocked(taskStore.listAll).mockResolvedValue([
      makeTask("os-cum", "open", ["attempts:5"]),
    ]);

    const result = await collectFailuresSince("proj-1", "2026-03-15T00:00:00.000Z");
    expect(result).toHaveLength(1);
    expect(result[0]!.attemptCount).toBe(5);
  });

  it("falls back to task label attempts when event data has no attempt field", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([
      makeEvent({
        event: "task.failed",
        taskId: "os-lab",
        data: { failureType: "test_failure" },
      }),
    ]);
    vi.mocked(taskStore.listAll).mockResolvedValue([
      makeTask("os-lab", "open", ["attempts:7"]),
    ]);

    const result = await collectFailuresSince("proj-1", "2026-03-15T00:00:00.000Z");
    expect(result).toHaveLength(1);
    expect(result[0]!.attemptCount).toBe(7);
  });

  it("truncates long error snippets to 500 chars", async () => {
    const longSnippet = "x".repeat(600);
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([
      makeEvent({
        event: "task.failed",
        taskId: "os-long",
        data: {
          failureType: "test_failure",
          summary: longSnippet,
          attempt: 1,
        },
      }),
    ]);
    vi.mocked(taskStore.listAll).mockResolvedValue([makeTask("os-long", "open")]);

    const result = await collectFailuresSince("proj-1", "2026-03-15T00:00:00.000Z");
    expect(result).toHaveLength(1);
    expect(result[0]!.errorSnippet!.length).toBeLessThanOrEqual(500);
    expect(result[0]!.errorSnippet!.endsWith("...")).toBe(true);
  });

  it("skips events with empty taskId", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([
      makeEvent({
        event: "task.failed",
        taskId: "",
        data: { failureType: "agent_crash", attempt: 1 },
      }),
    ]);

    const result = await collectFailuresSince("proj-1", "2026-03-15T00:00:00.000Z");
    expect(result).toEqual([]);
  });

  it("extracts failedGateOutputSnippet over summary for errorSnippet", async () => {
    vi.mocked(eventLogService.readSinceByProjectId).mockResolvedValue([
      makeEvent({
        event: "merge.failed",
        taskId: "os-gate",
        data: {
          failureType: "merge_quality_gate",
          failedGateOutputSnippet: "TS2345: specific error",
          summary: "Gate failed generally",
          attempt: 1,
        },
      }),
    ]);
    vi.mocked(taskStore.listAll).mockResolvedValue([makeTask("os-gate", "blocked")]);

    const result = await collectFailuresSince("proj-1", "2026-03-15T00:00:00.000Z");
    expect(result[0]!.errorSnippet).toBe("TS2345: specific error");
  });
});

describe("formatFailuresForPrompt", () => {
  it("returns empty string for empty failures array", () => {
    expect(formatFailuresForPrompt([])).toBe("");
  });

  it("formats a single failure with all fields", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1234",
        failureType: "quality_gate",
        rawFailureType: "merge_quality_gate",
        failedCommand: "npm run build",
        errorSnippet: "TS2345: Error",
        attemptCount: 2,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
    ];
    const result = formatFailuresForPrompt(failures);
    expect(result).toContain("Agent Failures Since Last Self-Improvement Run (1 total)");
    expect(result).toContain("### Task os-1234");
    expect(result).toContain("quality_gate");
    expect(result).toContain("merge_quality_gate");
    expect(result).toContain("`npm run build`");
    expect(result).toContain("TS2345: Error");
    expect(result).toContain("Attempts:** 2");
    expect(result).toContain("blocked");
  });

  it("formats multiple failures", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-a",
        failureType: "execution",
        attemptCount: 1,
        finalDisposition: "requeued",
        timestamp: "2026-03-20T10:00:00.000Z",
      },
      {
        taskId: "os-b",
        failureType: "merge",
        rawFailureType: "merge_conflict",
        attemptCount: 3,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T11:00:00.000Z",
      },
    ];
    const result = formatFailuresForPrompt(failures);
    expect(result).toContain("(2 total)");
    expect(result).toContain("### Task os-a");
    expect(result).toContain("### Task os-b");
  });

  it("omits failedCommand and errorSnippet when not present", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-min",
        failureType: "execution",
        attemptCount: 0,
        finalDisposition: "open",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
    ];
    const result = formatFailuresForPrompt(failures);
    expect(result).not.toContain("Failed command");
    expect(result).not.toContain("Error snippet");
    expect(result).toContain("### Task os-min");
    expect(result).toContain("execution");
  });

  it("omits raw failure type parenthetical when rawFailureType is absent", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-noraw",
        failureType: "execution",
        attemptCount: 1,
        finalDisposition: "open",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
    ];
    const result = formatFailuresForPrompt(failures);
    expect(result).toContain("**Failure type:** execution\n");
    expect(result).not.toContain("execution (");
  });
});

describe("buildFailureReviewSystemSupplement", () => {
  it("returns empty string when no failures", () => {
    expect(buildFailureReviewSystemSupplement([])).toBe("");
  });

  it("includes root-cause analysis instructions when failures present", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "execution",
        attemptCount: 2,
        finalDisposition: "requeued",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
    ];
    const result = buildFailureReviewSystemSupplement(failures);
    expect(result).toContain("Failure Root-Cause Analysis");
    expect(result).toContain("Group failures by pattern/root cause");
    expect(result).toContain("Classify each group as environmental/infrastructure or code/logic");
    expect(result).toContain("Identify recurring failure patterns");
    expect(result).toContain("Propose root-cause fix tasks");
    expect(result).toContain("do not use special title prefixes");
    expect(result).toContain("Root cause:");
    expect(result).toContain("Affected area:");
    expect(result).toContain("Remediation steps:");
    expect(result).toContain("Acceptance criteria:");
    expect(result).toContain("high-frequency");
    expect(result).toContain("high-impact");
  });

  it("mentions code/logic classification when execution failures present", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "execution",
        attemptCount: 1,
        finalDisposition: "open",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
    ];
    const result = buildFailureReviewSystemSupplement(failures);
    expect(result).toContain("Code/logic");
    expect(result).toContain("bugs, incorrect implementations");
  });

  it("mentions environmental/infrastructure classification when environment failures present", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "environment",
        attemptCount: 1,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
    ];
    const result = buildFailureReviewSystemSupplement(failures);
    expect(result).toContain("Environmental/infrastructure");
    expect(result).toContain("environment setup");
  });

  it("mentions both classifications when both failure types present", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "environment",
        attemptCount: 1,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
      {
        taskId: "os-2",
        failureType: "execution",
        attemptCount: 2,
        finalDisposition: "requeued",
        timestamp: "2026-03-20T13:00:00.000Z",
      },
    ];
    const result = buildFailureReviewSystemSupplement(failures);
    expect(result).toContain("Environmental/infrastructure");
    expect(result).toContain("Code/logic");
  });

  it("includes quality_gate failures in environmental/infrastructure category", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "quality_gate",
        attemptCount: 1,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
    ];
    const result = buildFailureReviewSystemSupplement(failures);
    expect(result).toContain("Environmental/infrastructure");
  });

  it("includes merge failures in code/logic category", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "merge",
        attemptCount: 1,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
    ];
    const result = buildFailureReviewSystemSupplement(failures);
    expect(result).toContain("Code/logic");
  });

  it("reports correct failure count in the supplement", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "execution",
        attemptCount: 1,
        finalDisposition: "open",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
      {
        taskId: "os-2",
        failureType: "execution",
        attemptCount: 3,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T13:00:00.000Z",
      },
      {
        taskId: "os-3",
        failureType: "environment",
        attemptCount: 1,
        finalDisposition: "requeued",
        timestamp: "2026-03-20T14:00:00.000Z",
      },
    ];
    const result = buildFailureReviewSystemSupplement(failures);
    expect(result).toContain("3 agent failure(s)");
  });
});

describe("buildFailureReviewUserSupplement", () => {
  it("returns empty string when no failures", () => {
    expect(buildFailureReviewUserSupplement([])).toBe("");
  });

  it("includes failure count and root-cause instruction when failures present", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "execution",
        attemptCount: 1,
        finalDisposition: "requeued",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
    ];
    const result = buildFailureReviewUserSupplement(failures);
    expect(result).toContain("1 failure(s)");
    expect(result).toContain("concrete root-cause fix tasks");
    expect(result).toContain("Failure Review");
  });

  it("includes blocked count in stats", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "execution",
        attemptCount: 1,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
      {
        taskId: "os-2",
        failureType: "merge",
        attemptCount: 2,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T13:00:00.000Z",
      },
    ];
    const result = buildFailureReviewUserSupplement(failures);
    expect(result).toContain("2 blocked");
  });

  it("includes requeued count in stats", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "execution",
        attemptCount: 1,
        finalDisposition: "requeued",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
    ];
    const result = buildFailureReviewUserSupplement(failures);
    expect(result).toContain("1 requeued");
  });

  it("includes multi-attempt count in stats", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "execution",
        attemptCount: 3,
        finalDisposition: "requeued",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
      {
        taskId: "os-2",
        failureType: "execution",
        attemptCount: 1,
        finalDisposition: "open",
        timestamp: "2026-03-20T13:00:00.000Z",
      },
    ];
    const result = buildFailureReviewUserSupplement(failures);
    expect(result).toContain("1 with multiple attempts");
  });

  it("includes all stats when multiple types present", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "execution",
        attemptCount: 3,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
      {
        taskId: "os-2",
        failureType: "merge",
        attemptCount: 1,
        finalDisposition: "requeued",
        timestamp: "2026-03-20T13:00:00.000Z",
      },
    ];
    const result = buildFailureReviewUserSupplement(failures);
    expect(result).toContain("2 failure(s)");
    expect(result).toContain("1 blocked");
    expect(result).toContain("1 requeued");
    expect(result).toContain("1 with multiple attempts");
  });
});

describe("prompt snapshot tests — failure-review dimension", () => {
  it("formatFailuresForPrompt snapshot: single failure with all fields", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-snap-1",
        failureType: "quality_gate",
        rawFailureType: "merge_quality_gate",
        failedCommand: "npm run build",
        errorSnippet: "TS2345: Argument of type 'string' is not assignable",
        attemptCount: 2,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
    ];
    expect(formatFailuresForPrompt(failures)).toMatchInlineSnapshot(`
      "## Agent Failures Since Last Self-Improvement Run (1 total)

      ### Task os-snap-1
      - **Failure type:** quality_gate (merge_quality_gate)
      - **Attempts:** 2
      - **Disposition:** blocked
      - **Failed command:** \`npm run build\`
      - **Error snippet:**
      \`\`\`
      TS2345: Argument of type 'string' is not assignable
      \`\`\`
      "
    `);
  });

  it("formatFailuresForPrompt snapshot: multiple failures with mixed fields", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-a",
        failureType: "execution",
        rawFailureType: "test_failure",
        attemptCount: 3,
        finalDisposition: "requeued",
        timestamp: "2026-03-20T10:00:00.000Z",
        errorSnippet: "Cannot find module 'react'",
      },
      {
        taskId: "os-b",
        failureType: "environment",
        rawFailureType: "environment_setup",
        attemptCount: 1,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T11:00:00.000Z",
      },
    ];
    expect(formatFailuresForPrompt(failures)).toMatchInlineSnapshot(`
      "## Agent Failures Since Last Self-Improvement Run (2 total)

      ### Task os-a
      - **Failure type:** execution (test_failure)
      - **Attempts:** 3
      - **Disposition:** requeued
      - **Error snippet:**
      \`\`\`
      Cannot find module 'react'
      \`\`\`

      ### Task os-b
      - **Failure type:** environment (environment_setup)
      - **Attempts:** 1
      - **Disposition:** blocked
      "
    `);
  });

  it("formatFailuresForPrompt snapshot: empty array returns empty string", () => {
    expect(formatFailuresForPrompt([])).toMatchInlineSnapshot(`""`);
  });

  it("buildFailureReviewSystemSupplement snapshot: code/logic failures only", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "execution",
        attemptCount: 2,
        finalDisposition: "requeued",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
    ];
    expect(buildFailureReviewSystemSupplement(failures)).toMatchInlineSnapshot(`
      "
      ## Failure Root-Cause Analysis

      You have been provided with 1 agent failure(s) from recent runs.
      In addition to general improvements, perform a **failure root-cause analysis**:

      1. **Group failures by pattern/root cause.** Identify clusters of failures that share the same underlying cause (e.g. missing dependency, flaky test, incorrect merge base).
      2. **Classify each group as environmental/infrastructure or code/logic:**
         - **Code/logic:** failures caused by bugs, incorrect implementations, test logic errors, or merge conflicts from overlapping changes.
      3. **Identify recurring failure patterns** that appear across multiple tasks. Prioritize patterns by frequency (how many tasks affected) and impact (blocked vs. requeued).
      4. **Propose root-cause fix tasks.** Each fix task MUST include:
         - A clear title that states the root-cause fix (do not use special title prefixes).
         - A \`description\` containing:
           - **Root cause:** one-sentence explanation of the underlying problem.
           - **Affected area:** file path(s), module(s), or subsystem(s) involved.
           - **Remediation steps:** concrete, numbered steps to fix the root cause.
           - **Acceptance criteria:** measurable conditions that confirm the fix works.
         - \`priority\` — lower (0-1) for high-frequency or high-impact patterns; higher (2-4) for isolated issues.
         - \`complexity\` — as usual, 1-10 based on implementation difficulty.

      Prioritize root-cause fix tasks for **high-frequency** (affecting multiple tasks) and **high-impact** (tasks blocked rather than requeued) failure patterns.
      Root-cause fix tasks should appear first in your output, before general improvement tasks."
    `);
  });

  it("buildFailureReviewSystemSupplement snapshot: environment/infra failures only", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "environment",
        attemptCount: 1,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
      {
        taskId: "os-2",
        failureType: "quality_gate",
        attemptCount: 2,
        finalDisposition: "requeued",
        timestamp: "2026-03-20T13:00:00.000Z",
      },
    ];
    expect(buildFailureReviewSystemSupplement(failures)).toMatchInlineSnapshot(`
      "
      ## Failure Root-Cause Analysis

      You have been provided with 2 agent failure(s) from recent runs.
      In addition to general improvements, perform a **failure root-cause analysis**:

      1. **Group failures by pattern/root cause.** Identify clusters of failures that share the same underlying cause (e.g. missing dependency, flaky test, incorrect merge base).
      2. **Classify each group as environmental/infrastructure or code/logic:**
         - **Environmental/infrastructure:** failures caused by environment setup, missing tools, dependency issues, CI configuration, or quality-gate command misconfiguration.
      3. **Identify recurring failure patterns** that appear across multiple tasks. Prioritize patterns by frequency (how many tasks affected) and impact (blocked vs. requeued).
      4. **Propose root-cause fix tasks.** Each fix task MUST include:
         - A clear title that states the root-cause fix (do not use special title prefixes).
         - A \`description\` containing:
           - **Root cause:** one-sentence explanation of the underlying problem.
           - **Affected area:** file path(s), module(s), or subsystem(s) involved.
           - **Remediation steps:** concrete, numbered steps to fix the root cause.
           - **Acceptance criteria:** measurable conditions that confirm the fix works.
         - \`priority\` — lower (0-1) for high-frequency or high-impact patterns; higher (2-4) for isolated issues.
         - \`complexity\` — as usual, 1-10 based on implementation difficulty.

      Prioritize root-cause fix tasks for **high-frequency** (affecting multiple tasks) and **high-impact** (tasks blocked rather than requeued) failure patterns.
      Root-cause fix tasks should appear first in your output, before general improvement tasks."
    `);
  });

  it("buildFailureReviewSystemSupplement snapshot: mixed failure types", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "environment",
        attemptCount: 1,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
      {
        taskId: "os-2",
        failureType: "execution",
        attemptCount: 3,
        finalDisposition: "requeued",
        timestamp: "2026-03-20T13:00:00.000Z",
      },
      {
        taskId: "os-3",
        failureType: "merge",
        attemptCount: 2,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T14:00:00.000Z",
      },
    ];
    expect(buildFailureReviewSystemSupplement(failures)).toMatchInlineSnapshot(`
      "
      ## Failure Root-Cause Analysis

      You have been provided with 3 agent failure(s) from recent runs.
      In addition to general improvements, perform a **failure root-cause analysis**:

      1. **Group failures by pattern/root cause.** Identify clusters of failures that share the same underlying cause (e.g. missing dependency, flaky test, incorrect merge base).
      2. **Classify each group as environmental/infrastructure or code/logic:**
         - **Environmental/infrastructure:** failures caused by environment setup, missing tools, dependency issues, CI configuration, or quality-gate command misconfiguration.
         - **Code/logic:** failures caused by bugs, incorrect implementations, test logic errors, or merge conflicts from overlapping changes.
      3. **Identify recurring failure patterns** that appear across multiple tasks. Prioritize patterns by frequency (how many tasks affected) and impact (blocked vs. requeued).
      4. **Propose root-cause fix tasks.** Each fix task MUST include:
         - A clear title that states the root-cause fix (do not use special title prefixes).
         - A \`description\` containing:
           - **Root cause:** one-sentence explanation of the underlying problem.
           - **Affected area:** file path(s), module(s), or subsystem(s) involved.
           - **Remediation steps:** concrete, numbered steps to fix the root cause.
           - **Acceptance criteria:** measurable conditions that confirm the fix works.
         - \`priority\` — lower (0-1) for high-frequency or high-impact patterns; higher (2-4) for isolated issues.
         - \`complexity\` — as usual, 1-10 based on implementation difficulty.

      Prioritize root-cause fix tasks for **high-frequency** (affecting multiple tasks) and **high-impact** (tasks blocked rather than requeued) failure patterns.
      Root-cause fix tasks should appear first in your output, before general improvement tasks."
    `);
  });

  it("buildFailureReviewSystemSupplement snapshot: empty returns empty string", () => {
    expect(buildFailureReviewSystemSupplement([])).toMatchInlineSnapshot(`""`);
  });

  it("buildFailureReviewUserSupplement snapshot: single requeued failure", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "execution",
        attemptCount: 1,
        finalDisposition: "requeued",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
    ];
    expect(buildFailureReviewUserSupplement(failures)).toMatchInlineSnapshot(`
      "
      **Failure Review:** The failures section above contains 1 failure(s) (1 requeued). Analyze them for root causes and include concrete root-cause fix tasks in your output. See the system instructions for the required fix-task format."
    `);
  });

  it("buildFailureReviewUserSupplement snapshot: mixed dispositions and multi-attempt", () => {
    const failures: CollectedFailure[] = [
      {
        taskId: "os-1",
        failureType: "execution",
        attemptCount: 3,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T10:00:00.000Z",
      },
      {
        taskId: "os-2",
        failureType: "environment",
        attemptCount: 1,
        finalDisposition: "requeued",
        timestamp: "2026-03-20T11:00:00.000Z",
      },
      {
        taskId: "os-3",
        failureType: "merge",
        attemptCount: 2,
        finalDisposition: "blocked",
        timestamp: "2026-03-20T12:00:00.000Z",
      },
    ];
    expect(buildFailureReviewUserSupplement(failures)).toMatchInlineSnapshot(`
      "
      **Failure Review:** The failures section above contains 3 failure(s) (2 blocked, 1 requeued, 2 with multiple attempts). Analyze them for root causes and include concrete root-cause fix tasks in your output. See the system instructions for the required fix-task format."
    `);
  });

  it("buildFailureReviewUserSupplement snapshot: empty returns empty string", () => {
    expect(buildFailureReviewUserSupplement([])).toMatchInlineSnapshot(`""`);
  });
});
