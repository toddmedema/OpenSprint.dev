import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, TaskLastExecutionSummary } from "@opensprint/shared";
import { TaskExecutionDiagnosticsService } from "../services/task-execution-diagnostics.service.js";

const mockReadForTask = vi.fn();

vi.mock("../services/event-log.service.js", () => ({
  eventLogService: {
    readForTask: (...args: unknown[]) => mockReadForTask(...args),
  },
}));

describe("TaskExecutionDiagnosticsService", () => {
  const projectId = "proj-1";
  const taskId = "os-eeac.39";
  const repoPath = "/tmp/repo";
  const lastExecutionSummary: TaskLastExecutionSummary = {
    at: "2026-03-01T17:04:21.000Z",
    attempt: 6,
    outcome: "blocked",
    phase: "merge",
    blockReason: "Merge Failure",
    summary:
      "Attempt 6 merge failed during merge_to_main: Command failed: git -c core.editor=true rebase --continue fatal: no rebase in progress",
  };

  const taskStore = {
    show: vi.fn().mockResolvedValue({
      id: taskId,
      status: "blocked",
      labels: ["attempts:6", "merge_stage:merge_to_main"],
      block_reason: "Merge Failure",
      last_execution_summary: lastExecutionSummary,
    }),
    getCumulativeAttemptsFromIssue: vi.fn().mockReturnValue(6),
  };

  const sessionManager = {
    listSessions: vi.fn().mockResolvedValue([
      {
        taskId,
        attempt: 1,
        agentType: "openai",
        agentModel: "gpt-5.3-codex",
        startedAt: "2026-03-01T16:08:24.000Z",
        completedAt: "2026-03-01T16:08:26.000Z",
        status: "failed",
        outputLog:
          "[Agent error: 404 This is not a chat model and thus not supported in the v1/chat/completions endpoint.]",
        gitBranch: "opensprint/os-eeac.39",
        gitDiff: null,
        testResults: null,
        failureReason:
          "Agent exited with code 1 without producing a result. Agent error: 404 This is not a chat model and thus not supported in the v1/chat/completions endpoint.",
      },
    ] satisfies AgentSession[]),
  };

  const projectService = {
    getProject: vi.fn().mockResolvedValue({ id: projectId, repoPath }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    taskStore.show.mockResolvedValue({
      id: taskId,
      status: "blocked",
      labels: ["attempts:6", "merge_stage:merge_to_main"],
      block_reason: "Merge Failure",
      last_execution_summary: lastExecutionSummary,
    });
    taskStore.getCumulativeAttemptsFromIssue.mockReturnValue(6);
    sessionManager.listSessions.mockResolvedValue([
      {
        taskId,
        attempt: 1,
        agentType: "openai",
        agentModel: "gpt-5.3-codex",
        startedAt: "2026-03-01T16:08:24.000Z",
        completedAt: "2026-03-01T16:08:26.000Z",
        status: "failed",
        outputLog:
          "[Agent error: 404 This is not a chat model and thus not supported in the v1/chat/completions endpoint.]",
        gitBranch: "opensprint/os-eeac.39",
        gitDiff: null,
        testResults: null,
        failureReason:
          "Agent exited with code 1 without producing a result. Agent error: 404 This is not a chat model and thus not supported in the v1/chat/completions endpoint.",
      },
    ] satisfies AgentSession[]);
    mockReadForTask.mockResolvedValue([
      {
        timestamp: "2026-03-01T16:08:20.000Z",
        projectId,
        taskId,
        event: "transition.start_task",
        data: { attempt: 1 },
      },
      {
        timestamp: "2026-03-01T16:08:24.000Z",
        projectId,
        taskId,
        event: "agent.spawned",
        data: { attempt: 1, phase: "coding", model: "gpt-5.3-codex" },
      },
      {
        timestamp: "2026-03-01T16:08:26.000Z",
        projectId,
        taskId,
        event: "task.failed",
        data: {
          attempt: 1,
          phase: "coding",
          failureType: "no_result",
          summary:
            "Coding failed: Agent exited with code 1 without producing a result. Agent error: 404 This is not a chat model",
          nextAction: "Requeued for retry",
        },
      },
      {
        timestamp: "2026-03-01T17:04:21.000Z",
        projectId,
        taskId,
        event: "merge.failed",
        data: {
          attempt: 6,
          stage: "merge_to_main",
          resolvedBy: "blocked",
          summary:
            "Attempt 6 merge failed during merge_to_main: Command failed: git -c core.editor=true rebase --continue fatal: no rebase in progress",
          conflictedFiles: [],
          nextAction: "Blocked pending investigation",
        },
      },
    ]);
  });

  it("reconstructs attempt history and latest blocked merge summary", async () => {
    const service = new TaskExecutionDiagnosticsService(
      projectService as never,
      taskStore as never,
      sessionManager as never
    );

    const diagnostics = await service.getDiagnostics(projectId, taskId);

    expect(projectService.getProject).toHaveBeenCalledWith(projectId);
    expect(taskStore.show).toHaveBeenCalledWith(projectId, taskId);
    expect(diagnostics.blockReason).toBe("Merge Failure");
    expect(diagnostics.cumulativeAttempts).toBe(6);
    expect(diagnostics.latestOutcome).toBe("blocked");
    expect(diagnostics.latestSummary).toContain("merge failed during merge_to_main");
    expect(diagnostics.attempts[0]).toEqual(
      expect.objectContaining({
        attempt: 6,
        finalPhase: "merge",
        finalOutcome: "blocked",
      })
    );
    expect(diagnostics.attempts.at(-1)).toEqual(
      expect.objectContaining({
        attempt: 1,
        finalPhase: "coding",
        finalOutcome: "failed",
      })
    );
  });
});
