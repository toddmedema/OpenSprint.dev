import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RepoConflictError } from "../services/git-commit-queue.service.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { OrchestratorService, formatReviewFeedback } from "../services/orchestrator.service.js";
import type { ReviewAgentResult } from "@opensprint/shared";
import { OPENSPRINT_PATHS } from "@opensprint/shared";

// ─── Mocks ───
// All mock fns must be created via vi.hoisted() so they're available inside vi.mock() factories.

const {
  mockBroadcastToProject,
  mockSendAgentOutputToProject,
  mockBeadsReady,
  mockBeadsShow,
  mockBeadsUpdate,
  mockBeadsClose,
  mockBeadsComment,
  mockBeadsHasLabel,
  mockBeadsAreAllBlockersClosed,
  mockBeadsGetCumulativeAttempts,
  mockBeadsSetCumulativeAttempts,
  mockBeadsAddLabel,
  mockBeadsRemoveLabel,
  mockBeadsExport,
  mockBeadsGetStatusMap,
  mockBeadsListAll,
  mockGetProject,
  mockGetRepoPath,
  mockGetSettings,
  mockCreateTaskWorktree,
  mockRemoveTaskWorktree,
  mockDeleteBranch,
  mockGetCommitCountAhead,
  mockCaptureBranchDiff,
  mockEnsureOnMain,
  mockWaitForGitReady,
  mockSymlinkNodeModules,
  mockMergeToMain,
  mockVerifyMerge,
  mockPushMain,
  mockGetChangedFiles,
  mockCommitWip,
  mockBuildContext,
  mockAssembleTaskDirectory,
  mockGetActiveDir,
  mockReadResult,
  mockClearResult,
  mockCreateSession,
  mockArchiveSession,
  mockRunScopedTests,
  mockInvokeCodingAgent,
  mockInvokeReviewAgent,
  mockInvokeMergerAgent,
  mockRecoverOrphanedTasks,
  mockRecoverFromStaleHeartbeats,
  mockWriteJsonAtomic,
  mockGitQueueEnqueue,
  mockGitQueueEnqueueAndWait,
  mockGetPlanComplexityForTask,
} = vi.hoisted(() => ({
  mockBroadcastToProject: vi.fn(),
  mockSendAgentOutputToProject: vi.fn(),
  mockBeadsReady: vi.fn(),
  mockBeadsShow: vi.fn(),
  mockBeadsUpdate: vi.fn(),
  mockBeadsClose: vi.fn(),
  mockBeadsComment: vi.fn(),
  mockBeadsHasLabel: vi.fn(),
  mockBeadsAreAllBlockersClosed: vi.fn(),
  mockBeadsGetCumulativeAttempts: vi.fn(),
  mockBeadsSetCumulativeAttempts: vi.fn(),
  mockBeadsAddLabel: vi.fn(),
  mockBeadsRemoveLabel: vi.fn(),
  mockBeadsExport: vi.fn().mockResolvedValue(undefined),
  mockBeadsGetStatusMap: vi.fn(),
  mockBeadsListAll: vi.fn(),
  mockGetProject: vi.fn(),
  mockGetRepoPath: vi.fn(),
  mockGetSettings: vi.fn(),
  mockCreateTaskWorktree: vi.fn(),
  mockRemoveTaskWorktree: vi.fn(),
  mockDeleteBranch: vi.fn(),
  mockGetCommitCountAhead: vi.fn(),
  mockCaptureBranchDiff: vi.fn(),
  mockEnsureOnMain: vi.fn(),
  mockWaitForGitReady: vi.fn(),
  mockSymlinkNodeModules: vi.fn(),
  mockMergeToMain: vi.fn(),
  mockVerifyMerge: vi.fn(),
  mockPushMain: vi.fn(),
  mockGetChangedFiles: vi.fn(),
  mockCommitWip: vi.fn(),
  mockBuildContext: vi.fn(),
  mockAssembleTaskDirectory: vi.fn(),
  mockGetActiveDir: vi.fn(),
  mockReadResult: vi.fn(),
  mockClearResult: vi.fn(),
  mockCreateSession: vi.fn(),
  mockArchiveSession: vi.fn(),
  mockRunScopedTests: vi.fn(),
  mockInvokeCodingAgent: vi.fn(),
  mockInvokeReviewAgent: vi.fn(),
  mockInvokeMergerAgent: vi.fn(),
  mockRecoverOrphanedTasks: vi.fn(),
  mockRecoverFromStaleHeartbeats: vi.fn(),
  mockWriteJsonAtomic: vi.fn(),
  mockGitQueueEnqueue: vi.fn().mockResolvedValue(undefined),
  mockGitQueueEnqueueAndWait: vi.fn().mockResolvedValue(undefined),
  mockGetPlanComplexityForTask: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../websocket/index.js", () => ({
  broadcastToProject: (...args: unknown[]) => mockBroadcastToProject(...args),
  sendAgentOutputToProject: (...args: unknown[]) => mockSendAgentOutputToProject(...args),
}));

vi.mock("../services/beads.service.js", () => ({
  BeadsService: vi.fn().mockImplementation(() => ({
    ready: mockBeadsReady,
    show: mockBeadsShow,
    update: mockBeadsUpdate,
    close: mockBeadsClose,
    comment: mockBeadsComment,
    hasLabel: mockBeadsHasLabel,
    areAllBlockersClosed: mockBeadsAreAllBlockersClosed,
    getCumulativeAttempts: mockBeadsGetCumulativeAttempts,
    setCumulativeAttempts: mockBeadsSetCumulativeAttempts,
    addLabel: mockBeadsAddLabel,
    removeLabel: mockBeadsRemoveLabel,
    export: mockBeadsExport,
    getStatusMap: mockBeadsGetStatusMap,
    listAll: mockBeadsListAll,
  })),
}));

vi.mock("../services/project.service.js", () => ({
  ProjectService: vi.fn().mockImplementation(() => ({
    getProject: mockGetProject,
    getRepoPath: mockGetRepoPath,
    getSettings: mockGetSettings,
  })),
}));

vi.mock("../services/branch-manager.js", () => {
  class _RebaseConflictError extends Error {
    conflictedFiles: string[];
    constructor(conflictedFiles: string[]) {
      super(`Rebase conflict in ${conflictedFiles.length} file(s)`);
      this.name = "RebaseConflictError";
      this.conflictedFiles = conflictedFiles;
    }
  }
  return {
    RebaseConflictError: _RebaseConflictError,
    BranchManager: vi.fn().mockImplementation(() => ({
      createTaskWorktree: mockCreateTaskWorktree,
      removeTaskWorktree: mockRemoveTaskWorktree,
      deleteBranch: mockDeleteBranch,
      getCommitCountAhead: mockGetCommitCountAhead,
      captureBranchDiff: mockCaptureBranchDiff,
      captureUncommittedDiff: vi.fn().mockResolvedValue(""),
      ensureOnMain: mockEnsureOnMain,
      waitForGitReady: mockWaitForGitReady,
      symlinkNodeModules: mockSymlinkNodeModules,
      mergeToMain: mockMergeToMain,
      verifyMerge: mockVerifyMerge,
      pushMain: mockPushMain,
      pushMainToOrigin: vi.fn().mockResolvedValue(undefined),
      getChangedFiles: mockGetChangedFiles,
      getConflictedFiles: vi.fn().mockResolvedValue([]),
      getConflictDiff: vi.fn().mockResolvedValue(""),
      rebaseContinue: vi.fn().mockResolvedValue(undefined),
      rebaseAbort: vi.fn().mockResolvedValue(undefined),
      isMergeInProgress: vi.fn().mockResolvedValue(false),
      mergeContinue: vi.fn().mockResolvedValue(undefined),
      mergeAbort: vi.fn().mockResolvedValue(undefined),
      isRebaseInProgress: vi.fn().mockResolvedValue(false),
      commitWip: mockCommitWip,
    })),
  };
});

vi.mock("../services/context-assembler.js", () => ({
  ContextAssembler: vi.fn().mockImplementation(() => ({
    buildContext: mockBuildContext,
    assembleTaskDirectory: mockAssembleTaskDirectory,
    generateMergeConflictPrompt: vi.fn().mockReturnValue("# Resolve Rebase Conflicts\n"),
  })),
}));

vi.mock("../services/session-manager.js", () => ({
  SessionManager: vi.fn().mockImplementation(() => ({
    getActiveDir: mockGetActiveDir,
    readResult: mockReadResult,
    clearResult: mockClearResult,
    createSession: mockCreateSession,
    archiveSession: mockArchiveSession,
  })),
}));

vi.mock("../services/test-runner.js", () => ({
  TestRunner: vi.fn().mockImplementation(() => ({
    runScopedTests: mockRunScopedTests,
  })),
}));

vi.mock("../services/agent.service.js", () => ({
  agentService: {
    invokeCodingAgent: mockInvokeCodingAgent,
    invokeReviewAgent: mockInvokeReviewAgent,
    invokeMergerAgent: mockInvokeMergerAgent,
  },
}));

vi.mock("../services/deployment-service.js", () => ({
  deploymentService: { deploy: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../services/orphan-recovery.service.js", () => ({
  orphanRecoveryService: {
    recoverOrphanedTasks: mockRecoverOrphanedTasks,
    recoverFromStaleHeartbeats: mockRecoverFromStaleHeartbeats,
  },
}));

vi.mock("../services/heartbeat.service.js", () => ({
  heartbeatService: {
    writeHeartbeat: vi.fn().mockResolvedValue(undefined),
    deleteHeartbeat: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../services/git-commit-queue.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/git-commit-queue.service.js")>();
  return {
    ...actual,
    gitCommitQueue: {
      enqueue: mockGitQueueEnqueue,
      enqueueAndWait: mockGitQueueEnqueueAndWait,
      drain: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock("../utils/file-utils.js", () => ({
  writeJsonAtomic: (...args: unknown[]) => mockWriteJsonAtomic(...args),
}));

vi.mock("../services/plan-complexity.js", () => ({
  getPlanComplexityForTask: (...args: unknown[]) => mockGetPlanComplexityForTask(...args),
}));

// ─── Tests ───

describe("OrchestratorService", () => {
  let orchestrator: OrchestratorService;
  let repoPath: string;
  const projectId = "test-project-1";

  beforeEach(async () => {
    vi.clearAllMocks();
    orchestrator = new OrchestratorService();

    repoPath = path.join(os.tmpdir(), `orchestrator-test-${Date.now()}`);
    await fs.mkdir(repoPath, { recursive: true });
    await fs.mkdir(path.join(repoPath, ".opensprint"), { recursive: true });

    mockGetProject.mockResolvedValue({ id: projectId });
    mockGetRepoPath.mockResolvedValue(repoPath);
    mockGetSettings.mockResolvedValue({
      testFramework: "vitest",
      codingAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
      reviewMode: "never",
      deployment: { autoDeployOnEpicCompletion: false, autoResolveFeedbackOnTaskCompletion: false },
    });
    mockRecoverOrphanedTasks.mockResolvedValue({ recovered: [] });
    mockRecoverFromStaleHeartbeats.mockResolvedValue({ recovered: [] });
    mockBeadsGetStatusMap.mockResolvedValue(new Map());
    mockBeadsListAll.mockResolvedValue([]);
    mockCaptureBranchDiff.mockResolvedValue("");
    mockCommitWip.mockResolvedValue(undefined);
    mockRemoveTaskWorktree.mockResolvedValue(undefined);
    mockDeleteBranch.mockResolvedValue(undefined);
    mockBeadsComment.mockResolvedValue(undefined);
    mockBeadsUpdate.mockResolvedValue(undefined);
    mockBeadsClose.mockResolvedValue(undefined);
    mockBeadsSetCumulativeAttempts.mockResolvedValue(undefined);
    mockCreateSession.mockResolvedValue({ id: "sess-default" });
    mockArchiveSession.mockResolvedValue(undefined);
    mockGetChangedFiles.mockResolvedValue([]);
    mockEnsureOnMain.mockResolvedValue(undefined);
    mockWaitForGitReady.mockResolvedValue(undefined);
    mockPushMain.mockResolvedValue(undefined);
    mockMergeToMain.mockResolvedValue(undefined);
    mockRunScopedTests.mockResolvedValue({ passed: 0, failed: 0, rawOutput: "" });
    mockBuildContext.mockResolvedValue({
      prdExcerpt: "",
      planContent: "",
      dependencyOutputs: [],
      taskDescription: "",
    });
  });

  afterEach(async () => {
    orchestrator.stopProject(projectId);
    try {
      await fs.rm(repoPath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("formatReviewFeedback (exported helper)", () => {
    it("formats result with summary only", () => {
      const result: ReviewAgentResult = {
        status: "rejected",
        summary: "Tests do not adequately cover the ticket scope.",
        notes: "",
      };
      expect(formatReviewFeedback(result)).toBe("Tests do not adequately cover the ticket scope.");
    });

    it("formats result with summary and issues", () => {
      const result: ReviewAgentResult = {
        status: "rejected",
        summary: "Implementation has quality issues.",
        issues: ["Missing error handling", "Tests do not cover edge cases"],
        notes: "",
      };
      const formatted = formatReviewFeedback(result);
      expect(formatted).toContain("Implementation has quality issues.");
      expect(formatted).toContain("Issues to address:");
      expect(formatted).toContain("- Missing error handling");
      expect(formatted).toContain("- Tests do not cover edge cases");
    });

    it("handles missing summary gracefully", () => {
      const result = {
        status: "rejected",
      } as unknown as ReviewAgentResult;
      expect(formatReviewFeedback(result)).toBe(
        "Review rejected (no details provided by review agent)."
      );
    });
  });

  describe("getStatus", () => {
    it("returns default status when project exists", async () => {
      const status = await orchestrator.getStatus(projectId);
      expect(status).toEqual({
        currentTask: null,
        currentPhase: null,
        queueDepth: 0,
        totalDone: 0,
        totalFailed: 0,
        pendingFeedbackCategorizations: [],
        worktreePath: null,
      });
      expect(mockGetProject).toHaveBeenCalledWith(projectId);
    });
  });

  describe("getActiveAgents", () => {
    it("returns empty array when idle", async () => {
      const agents = await orchestrator.getActiveAgents(projectId);
      expect(agents).toEqual([]);
      expect(mockGetProject).toHaveBeenCalledWith(projectId);
    });
  });

  describe("stopProject", () => {
    it("does nothing when project has no state", () => {
      expect(() => orchestrator.stopProject(projectId)).not.toThrow();
    });

    it("cleans up state when project has state", async () => {
      // Get state by calling getStatus first
      await orchestrator.getStatus(projectId);
      orchestrator.stopProject(projectId);
      // After stop, getStatus would create fresh state
      const status = await orchestrator.getStatus(projectId);
      expect(status.currentTask).toBeNull();
    });
  });

  describe("nudge", () => {
    it("does not start loop when no ready tasks", async () => {
      mockBeadsReady.mockResolvedValue([]);

      await orchestrator.ensureRunning(projectId);
      orchestrator.nudge(projectId);

      // Give loop time to run
      await new Promise((r) => setTimeout(r, 100));

      // Should have broadcast execute.status with null task
      expect(mockBroadcastToProject).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          type: "execute.status",
          currentTask: null,
          queueDepth: 0,
        })
      );
    });

    it("does not start second loop when one is already active", async () => {
      mockBeadsReady.mockResolvedValue([
        {
          id: "task-1",
          title: "Test task",
          issue_type: "task",
          priority: 2,
          status: "open",
        },
      ]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(path.join(repoPath, "wt-1"));
      mockGetActiveDir.mockReturnValue(
        path.join(repoPath, "wt-1", ".opensprint", "active", "task-1")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);

      // Never actually spawn agent - make createTaskWorktree throw after first call to simulate
      // loop being "active" during the coding phase setup. Actually, the loop will call
      // executeCodingPhase which will call createTaskWorktree. If we make the agent spawn
      // return a handle that never exits, the loop stays "active".
      const mockKill = vi.fn();
      mockInvokeCodingAgent.mockReturnValue({
        kill: mockKill,
        pid: 12345,
      });

      await orchestrator.ensureRunning(projectId);

      // First nudge starts the loop. Second nudge while loop is active should return early.
      orchestrator.nudge(projectId);
      orchestrator.nudge(projectId);
      await new Promise((r) => setTimeout(r, 200));
      // Should not have started a second runLoop - we'd see duplicate agent.started if so
      const agentStartedCalls = mockBroadcastToProject.mock.calls.filter(
        (c: [string, { type?: string }]) => c[1]?.type === "agent.started"
      );
      expect(agentStartedCalls.length).toBeLessThanOrEqual(1);
      // agent.started includes startedAt so frontend can compute elapsed time without separate fetch
      if (agentStartedCalls.length > 0) {
        const payload = agentStartedCalls[0][1] as {
          type: string;
          taskId: string;
          startedAt?: string;
        };
        expect(payload.startedAt).toBeDefined();
        expect(typeof payload.startedAt).toBe("string");
      }
    });
  });

  describe("ensureRunning - crash recovery", () => {
    it("performs crash recovery when persisted state has dead PID and no commits", async () => {
      const persistedState = {
        projectId,
        currentTaskId: "task-crashed",
        currentTaskTitle: "Crashed task",
        currentPhase: "coding" as const,
        branchName: "opensprint/task-crashed",
        worktreePath: null,
        agentPid: 999999999, // Non-existent PID (dead)
        attempt: 1,
        startedAt: new Date().toISOString(),
        lastTransition: new Date().toISOString(),
        queueDepth: 0,
        totalDone: 0,
        totalFailed: 0,
      };

      const statePath = path.join(repoPath, OPENSPRINT_PATHS.orchestratorState);
      await fs.writeFile(statePath, JSON.stringify(persistedState), "utf-8");

      mockGetCommitCountAhead.mockResolvedValue(0);
      mockCaptureBranchDiff.mockResolvedValue("");

      await orchestrator.ensureRunning(projectId);

      // Wait for async recovery
      await new Promise((r) => setTimeout(r, 150));

      // Should have cleared persisted state (unlink)
      const statePathAfter = path.join(repoPath, OPENSPRINT_PATHS.orchestratorState);
      await expect(fs.access(statePathAfter)).rejects.toThrow();

      // Should have removed worktree
      expect(mockRemoveTaskWorktree).toHaveBeenCalledWith(repoPath, "task-crashed");

      // Should have deleted branch (no commits to preserve)
      expect(mockDeleteBranch).toHaveBeenCalledWith(repoPath, "opensprint/task-crashed");

      // Should have commented on task
      expect(mockBeadsComment).toHaveBeenCalledWith(
        repoPath,
        "task-crashed",
        "Agent crashed (backend restart). No committed work found, task requeued."
      );

      // Should have requeued task
      expect(mockBeadsUpdate).toHaveBeenCalledWith(repoPath, "task-crashed", {
        status: "open",
        assignee: "",
      });

      // Should have broadcast task.updated
      expect(mockBroadcastToProject).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          type: "task.updated",
          taskId: "task-crashed",
          status: "open",
          assignee: null,
        })
      );
    });

    it("preserves branch when crash recovery finds committed work", async () => {
      const persistedState = {
        projectId,
        currentTaskId: "task-crashed-2",
        currentTaskTitle: "Task with work",
        currentPhase: "coding" as const,
        branchName: "opensprint/task-crashed-2",
        worktreePath: null,
        agentPid: 999999999,
        attempt: 1,
        startedAt: new Date().toISOString(),
        lastTransition: new Date().toISOString(),
        queueDepth: 0,
        totalDone: 0,
        totalFailed: 0,
      };

      const statePath = path.join(repoPath, OPENSPRINT_PATHS.orchestratorState);
      await fs.writeFile(statePath, JSON.stringify(persistedState), "utf-8");

      mockGetCommitCountAhead.mockResolvedValue(2);
      mockCaptureBranchDiff.mockResolvedValue("diff content");

      await orchestrator.ensureRunning(projectId);

      await new Promise((r) => setTimeout(r, 150));

      // Should NOT have deleted branch (has commits)
      expect(mockDeleteBranch).not.toHaveBeenCalled();

      // Should have commented about preserving branch
      expect(mockBeadsComment).toHaveBeenCalledWith(
        repoPath,
        "task-crashed-2",
        "Agent crashed (backend restart). Branch preserved with 2 commits for next attempt."
      );

      // Should still requeue
      expect(mockBeadsUpdate).toHaveBeenCalledWith(repoPath, "task-crashed-2", {
        status: "open",
        assignee: "",
      });
    });

    it("advances to review when crash recovery finds result.json success and branch has commits", async () => {
      const wtPath = path.join(repoPath, "wt-result-success");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });
      await fs.mkdir(path.join(wtPath, ".opensprint", "active", "task-result-success"), {
        recursive: true,
      });
      mockGetActiveDir.mockImplementation((base: string, tid: string) =>
        path.join(base, ".opensprint", "active", tid)
      );

      const persistedState = {
        projectId,
        currentTaskId: "task-result-success",
        currentTaskTitle: "Task with successful result",
        currentPhase: "coding" as const,
        branchName: "opensprint/task-result-success",
        worktreePath: wtPath,
        agentPid: 999999999, // Dead PID
        attempt: 1,
        startedAt: new Date().toISOString(),
        lastTransition: new Date().toISOString(),
        lastOutputTimestamp: null,
        queueDepth: 0,
        totalDone: 0,
        totalFailed: 0,
      };

      const statePath = path.join(repoPath, OPENSPRINT_PATHS.orchestratorState);
      await fs.writeFile(statePath, JSON.stringify(persistedState), "utf-8");

      mockReadResult.mockResolvedValue({ status: "success", summary: "Implemented feature" });
      mockGetCommitCountAhead.mockResolvedValue(2);
      mockCaptureBranchDiff.mockResolvedValue("diff content");
      mockGetChangedFiles.mockResolvedValue([]);
      mockRunScopedTests.mockResolvedValue({
        passed: 3,
        failed: 0,
        rawOutput: "tests passed",
      });
      mockBeadsShow.mockResolvedValue({
        id: "task-result-success",
        title: "Task with successful result",
        issue_type: "task",
        priority: 2,
        status: "in_progress",
      });
      mockGetSettings.mockResolvedValue({
        testFramework: "vitest",
        codingAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
        reviewMode: "always",
        deployment: {
          autoDeployOnEpicCompletion: false,
          autoResolveFeedbackOnTaskCompletion: false,
        },
      });
      mockCommitWip.mockResolvedValue(undefined);
      mockMergeToMain.mockResolvedValue(undefined);
      mockCreateSession.mockResolvedValue({ id: "sess-1" });
      mockArchiveSession.mockResolvedValue(undefined);

      let reviewOnExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeReviewAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          reviewOnExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12346 };
        }
      );

      await orchestrator.ensureRunning(projectId);

      await new Promise((r) => setTimeout(r, 150));

      // Should NOT requeue — should have advanced to review
      expect(mockBeadsUpdate).not.toHaveBeenCalledWith(
        repoPath,
        "task-result-success",
        expect.objectContaining({ status: "open" })
      );

      // Should NOT have removed worktree (we need it for review)
      expect(mockRemoveTaskWorktree).not.toHaveBeenCalledWith(repoPath, "task-result-success");

      // Should have invoked review agent
      expect(mockInvokeReviewAgent).toHaveBeenCalled();

      // Should have read result.json from worktree
      expect(mockReadResult).toHaveBeenCalledWith(wtPath, "task-result-success");

      // Clean up: simulate review agent exit so we don't leave timers running
      await reviewOnExit(0);
      await new Promise((r) => setTimeout(r, 100));
    });

    it("requeues when crash recovery finds result.json success but tests fail", async () => {
      const wtPath = path.join(repoPath, "wt-result-tests-fail");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      const persistedState = {
        projectId,
        currentTaskId: "task-result-tests-fail",
        currentTaskTitle: "Task with result but failing tests",
        currentPhase: "coding" as const,
        branchName: "opensprint/task-result-tests-fail",
        worktreePath: wtPath,
        agentPid: 999999999,
        attempt: 1,
        startedAt: new Date().toISOString(),
        lastTransition: new Date().toISOString(),
        lastOutputTimestamp: null,
        queueDepth: 0,
        totalDone: 0,
        totalFailed: 0,
      };

      const statePath = path.join(repoPath, OPENSPRINT_PATHS.orchestratorState);
      await fs.writeFile(statePath, JSON.stringify(persistedState), "utf-8");

      mockReadResult.mockResolvedValue({ status: "success", summary: "Done" });
      mockGetCommitCountAhead.mockResolvedValue(1);
      mockGetChangedFiles.mockResolvedValue([]);
      mockRunScopedTests.mockResolvedValue({
        passed: 1,
        failed: 2,
        rawOutput: "2 tests failed",
      });

      await orchestrator.ensureRunning(projectId);

      await new Promise((r) => setTimeout(r, 150));

      // Tests failed — should fall through to normal recovery and requeue
      expect(mockBeadsUpdate).toHaveBeenCalledWith(repoPath, "task-result-tests-fail", {
        status: "open",
        assignee: "",
      });
      expect(mockRemoveTaskWorktree).toHaveBeenCalledWith(repoPath, "task-result-tests-fail");
    });

    it("requeues when crash recovery has result.json but no commits (commitCount 0)", async () => {
      const wtPath = path.join(repoPath, "wt-result-no-commits");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      const persistedState = {
        projectId,
        currentTaskId: "task-result-no-commits",
        currentTaskTitle: "Task with result but no commits",
        currentPhase: "coding" as const,
        branchName: "opensprint/task-result-no-commits",
        worktreePath: wtPath,
        agentPid: 999999999,
        attempt: 1,
        startedAt: new Date().toISOString(),
        lastTransition: new Date().toISOString(),
        lastOutputTimestamp: null,
        queueDepth: 0,
        totalDone: 0,
        totalFailed: 0,
      };

      const statePath = path.join(repoPath, OPENSPRINT_PATHS.orchestratorState);
      await fs.writeFile(statePath, JSON.stringify(persistedState), "utf-8");

      mockReadResult.mockResolvedValue({ status: "success", summary: "Done" });
      mockGetCommitCountAhead.mockResolvedValue(0);

      await orchestrator.ensureRunning(projectId);

      await new Promise((r) => setTimeout(r, 150));

      // No commits — should requeue (result.json without commits is suspicious)
      expect(mockBeadsUpdate).toHaveBeenCalledWith(repoPath, "task-result-no-commits", {
        status: "open",
        assignee: "",
      });
    });

    it("resumes review when crash recovery finds phase review and dead PID", async () => {
      const wtPath = path.join(repoPath, "wt-review-resume");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });
      await fs.mkdir(path.join(wtPath, ".opensprint", "active", "task-review-resume"), {
        recursive: true,
      });
      mockGetActiveDir.mockImplementation((base: string, tid: string) =>
        path.join(base, ".opensprint", "active", tid)
      );

      const persistedState = {
        projectId,
        currentTaskId: "task-review-resume",
        currentTaskTitle: "Task in review",
        currentPhase: "review" as const,
        branchName: "opensprint/task-review-resume",
        worktreePath: wtPath,
        agentPid: 999999999, // Dead PID
        attempt: 1,
        startedAt: new Date().toISOString(),
        lastTransition: new Date().toISOString(),
        lastOutputTimestamp: null,
        queueDepth: 0,
        totalDone: 0,
        totalFailed: 0,
      };

      const statePath = path.join(repoPath, OPENSPRINT_PATHS.orchestratorState);
      await fs.writeFile(statePath, JSON.stringify(persistedState), "utf-8");

      mockGetCommitCountAhead.mockResolvedValue(2);
      mockBeadsShow.mockResolvedValue({
        id: "task-review-resume",
        title: "Task in review",
        issue_type: "task",
        priority: 2,
        status: "in_progress",
      });
      mockGetSettings.mockResolvedValue({
        testFramework: "vitest",
        codingAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
        reviewMode: "always",
        deployment: {
          autoDeployOnEpicCompletion: false,
          autoResolveFeedbackOnTaskCompletion: false,
        },
      });
      mockBuildContext.mockResolvedValue({});
      mockAssembleTaskDirectory.mockResolvedValue(undefined);

      let reviewOnExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeReviewAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          reviewOnExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12347 };
        }
      );

      await orchestrator.ensureRunning(projectId);

      await new Promise((r) => setTimeout(r, 150));

      // Should NOT requeue — should have resumed review
      expect(mockBeadsUpdate).not.toHaveBeenCalledWith(
        repoPath,
        "task-review-resume",
        expect.objectContaining({ status: "open" })
      );

      // Should NOT have removed worktree
      expect(mockRemoveTaskWorktree).not.toHaveBeenCalledWith(repoPath, "task-review-resume");

      // Should have invoked review agent
      expect(mockInvokeReviewAgent).toHaveBeenCalled();

      // Clean up: simulate review agent exit so we don't leave timers running
      await reviewOnExit(0);
      await new Promise((r) => setTimeout(r, 100));
    });

    it("requeues when crash recovery finds phase review but worktree missing", async () => {
      const persistedState = {
        projectId,
        currentTaskId: "task-review-no-wt",
        currentTaskTitle: "Task in review",
        currentPhase: "review" as const,
        branchName: "opensprint/task-review-no-wt",
        worktreePath: path.join(repoPath, "nonexistent-worktree"), // Path that doesn't exist
        agentPid: 999999999,
        attempt: 1,
        startedAt: new Date().toISOString(),
        lastTransition: new Date().toISOString(),
        lastOutputTimestamp: null,
        queueDepth: 0,
        totalDone: 0,
        totalFailed: 0,
      };

      const statePath = path.join(repoPath, OPENSPRINT_PATHS.orchestratorState);
      await fs.writeFile(statePath, JSON.stringify(persistedState), "utf-8");

      mockGetCommitCountAhead.mockResolvedValue(2);

      await orchestrator.ensureRunning(projectId);

      await new Promise((r) => setTimeout(r, 150));

      // Worktree missing — should fall through to requeue
      expect(mockBeadsUpdate).toHaveBeenCalledWith(repoPath, "task-review-no-wt", {
        status: "open",
        assignee: "",
      });
    });

    it("starts fresh when persisted state has no active task", async () => {
      const persistedState = {
        projectId,
        currentTaskId: null,
        currentTaskTitle: null,
        currentPhase: null,
        branchName: null,
        worktreePath: null,
        agentPid: null,
        attempt: 1,
        startedAt: null,
        lastTransition: new Date().toISOString(),
        queueDepth: 0,
        totalDone: 5,
        totalFailed: 1,
      };

      const statePath = path.join(repoPath, OPENSPRINT_PATHS.orchestratorState);
      await fs.writeFile(statePath, JSON.stringify(persistedState), "utf-8");

      mockBeadsReady.mockResolvedValue([]);

      await orchestrator.ensureRunning(projectId);

      await new Promise((r) => setTimeout(r, 150));

      // State file should be cleared
      await expect(
        fs.access(path.join(repoPath, OPENSPRINT_PATHS.orchestratorState))
      ).rejects.toThrow();
    });
  });

  describe("full cycle: nudge → pickTask → runAgentTask → handleCompletion", () => {
    it("exercises complete flow: nudge starts loop, picks task, runs agent, handles success", async () => {
      const task = {
        id: "task-full-cycle",
        title: "Full cycle task",
        issue_type: "task",
        priority: 2,
        status: "open",
      };

      const wtPath = path.join(repoPath, "wt-full-cycle");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPath);
      mockGetActiveDir.mockReturnValue(
        path.join(wtPath, ".opensprint", "active", "task-full-cycle")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockGetChangedFiles.mockResolvedValue([]);
      mockRunScopedTests.mockResolvedValue({
        passed: 3,
        failed: 0,
        rawOutput: "tests passed",
      });
      mockReadResult.mockResolvedValue({ status: "success", summary: "Implemented" });

      let onExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeCodingAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          onExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12345 };
        }
      );

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      expect(mockBeadsReady).toHaveBeenCalled();
      expect(mockBeadsUpdate).toHaveBeenCalledWith(
        repoPath,
        "task-full-cycle",
        expect.objectContaining({ status: "in_progress", assignee: "agent-1" })
      );
      expect(mockInvokeCodingAgent).toHaveBeenCalled();

      mockBeadsShow.mockResolvedValue({ ...task, status: "in_progress" });
      mockCreateSession.mockResolvedValue({ id: "sess-1" });
      mockArchiveSession.mockResolvedValue(undefined);

      await onExit(0);
      await new Promise((r) => setTimeout(r, 300));

      expect(mockBeadsClose).toHaveBeenCalledWith(repoPath, "task-full-cycle", "Implemented");
      expect(mockBroadcastToProject).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          type: "agent.completed",
          taskId: "task-full-cycle",
          status: "approved",
        })
      );
    });
  });

  describe("ensureRunning - full loop with task completion", () => {
    it("completes task when coding succeeds and reviewMode is never", async () => {
      const task = {
        id: "task-complete-1",
        title: "Complete me",
        issue_type: "task",
        priority: 2,
        status: "open",
      };

      const wtPathComplete = path.join(repoPath, "wt-complete");
      await fs.mkdir(path.join(wtPathComplete, "node_modules"), {
        recursive: true,
      });

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPathComplete);
      mockGetActiveDir.mockReturnValue(
        path.join(repoPath, "wt-complete", ".opensprint", "active", "task-complete-1")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockGetChangedFiles.mockResolvedValue([]);
      mockRunScopedTests.mockResolvedValue({
        passed: 3,
        failed: 0,
        rawOutput: "tests passed",
      });
      mockReadResult.mockResolvedValue({ status: "success", summary: "Done" });

      let onExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeCodingAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          onExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12345 };
        }
      );

      await orchestrator.ensureRunning(projectId);

      await new Promise((r) => setTimeout(r, 300));

      mockBeadsShow.mockResolvedValue({ ...task, status: "in_progress" });
      mockMergeToMain.mockResolvedValue(undefined);
      mockCreateSession.mockResolvedValue({ id: "sess-1" });
      mockArchiveSession.mockResolvedValue(undefined);

      await onExit(0);

      await new Promise((r) => setTimeout(r, 300));

      // Should have merged and closed
      expect(mockBeadsClose).toHaveBeenCalledWith(repoPath, "task-complete-1", "Done");
      expect(mockGitQueueEnqueueAndWait).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "worktree_merge",
          repoPath,
          branchName: "opensprint/task-complete-1",
        })
      );
      expect(mockBroadcastToProject).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          type: "agent.completed",
          taskId: "task-complete-1",
          status: "approved",
        })
      );
    });

    it("completes task when review agent approves (result.json status approved)", async () => {
      const task = {
        id: "task-review-approve",
        title: "Task with review",
        issue_type: "task",
        priority: 2,
        status: "open",
      };

      const wtPath = path.join(repoPath, "wt-review");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      mockGetSettings.mockResolvedValue({
        testFramework: "vitest",
        codingAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
        reviewMode: "always",
        deployment: {
          autoDeployOnEpicCompletion: false,
          autoResolveFeedbackOnTaskCompletion: false,
        },
      });

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPath);
      mockGetActiveDir.mockReturnValue(
        path.join(wtPath, ".opensprint", "active", "task-review-approve")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockGetChangedFiles.mockResolvedValue([]);
      mockRunScopedTests.mockResolvedValue({
        passed: 3,
        failed: 0,
        rawOutput: "tests passed",
      });
      mockCaptureBranchDiff.mockResolvedValue("diff content");

      // First call: coding agent result (success); second call: review agent result (approved)
      mockReadResult
        .mockResolvedValueOnce({ status: "success", summary: "Implemented feature" })
        .mockResolvedValueOnce({
          status: "approved",
          summary: "Implementation meets all acceptance criteria.",
        });

      let codingOnExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeCodingAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          codingOnExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12345 };
        }
      );

      let reviewOnExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeReviewAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          reviewOnExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12346 };
        }
      );

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      // Coding agent exits with success
      await codingOnExit(0);
      await new Promise((r) => setTimeout(r, 300));

      // Review agent should have been invoked
      expect(mockInvokeReviewAgent).toHaveBeenCalled();
      expect(mockBeadsClose).not.toHaveBeenCalled();

      mockBeadsShow.mockResolvedValue({ ...task, status: "in_progress" });
      mockCreateSession.mockResolvedValue({ id: "sess-1" });
      mockArchiveSession.mockResolvedValue(undefined);

      // Review agent exits with approved
      await reviewOnExit(0);
      await new Promise((r) => setTimeout(r, 300));

      // On result.json approved: merge and Done
      expect(mockGitQueueEnqueueAndWait).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "worktree_merge",
          repoPath,
          branchName: "opensprint/task-review-approve",
        })
      );
      expect(mockBeadsClose).toHaveBeenCalledWith(
        repoPath,
        "task-review-approve",
        "Implemented feature"
      );
      expect(mockBroadcastToProject).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          type: "task.updated",
          taskId: "task-review-approve",
          status: "closed",
          assignee: null,
        })
      );
      expect(mockBroadcastToProject).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          type: "agent.completed",
          taskId: "task-review-approve",
          status: "approved",
        })
      );
    });

    it("treats result.json status 'approve' as approved (normalization)", async () => {
      const task = {
        id: "task-approve-normalize",
        title: "Task with approve status",
        issue_type: "task",
        priority: 2,
        status: "open",
      };

      const wtPath = path.join(repoPath, "wt-approve-norm");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      mockGetSettings.mockResolvedValue({
        testFramework: "vitest",
        codingAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
        reviewMode: "always",
        deployment: {
          autoDeployOnEpicCompletion: false,
          autoResolveFeedbackOnTaskCompletion: false,
        },
      });

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPath);
      mockGetActiveDir.mockReturnValue(
        path.join(wtPath, ".opensprint", "active", "task-approve-normalize")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockGetChangedFiles.mockResolvedValue([]);
      mockRunScopedTests.mockResolvedValue({
        passed: 2,
        failed: 0,
        rawOutput: "ok",
      });
      mockCaptureBranchDiff.mockResolvedValue("");

      mockReadResult
        .mockResolvedValueOnce({ status: "success", summary: "Done" })
        .mockResolvedValueOnce({ status: "approve", summary: "Looks good" });

      let codingOnExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeCodingAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          codingOnExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12345 };
        }
      );

      let reviewOnExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeReviewAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          reviewOnExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12346 };
        }
      );

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));
      await codingOnExit(0);
      await new Promise((r) => setTimeout(r, 300));

      mockCreateSession.mockResolvedValue({ id: "sess-1" });
      mockArchiveSession.mockResolvedValue(undefined);

      await reviewOnExit(0);
      await new Promise((r) => setTimeout(r, 300));

      expect(mockGitQueueEnqueueAndWait).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "worktree_merge",
          repoPath,
          branchName: "opensprint/task-approve-normalize",
        })
      );
      expect(mockBeadsClose).toHaveBeenCalledWith(repoPath, "task-approve-normalize", "Done");
    });
  });

  describe("progressive backoff - test failure retry", () => {
    it("retries immediately when tests fail (attempt 1, not demotion point)", async () => {
      const task = {
        id: "task-test-fail",
        title: "Task with test failure",
        issue_type: "task",
        priority: 2,
        status: "open",
      };

      const wtPath = path.join(repoPath, "wt-fail");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPath);
      mockGetActiveDir.mockReturnValue(
        path.join(repoPath, "wt-fail", ".opensprint", "active", "task-test-fail")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockGetChangedFiles.mockResolvedValue([]);
      // Agent succeeds but tests fail
      mockReadResult.mockResolvedValue({ status: "success", summary: "Code done" });
      mockRunScopedTests.mockResolvedValue({
        passed: 1,
        failed: 2,
        rawOutput: "2 tests failed",
      });

      let onExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeCodingAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          onExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12345 };
        }
      );

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      mockBeadsSetCumulativeAttempts.mockResolvedValue(undefined);

      await onExit(0);
      await new Promise((r) => setTimeout(r, 400));

      // Should have added failure comment
      expect(mockBeadsComment).toHaveBeenCalledWith(
        repoPath,
        "task-test-fail",
        expect.stringContaining("Attempt 1 failed [test_failure]")
      );

      // Should have archived session
      expect(mockArchiveSession).toHaveBeenCalled();

      // Should have set cumulative attempts for retry
      expect(mockBeadsSetCumulativeAttempts).toHaveBeenCalledWith(repoPath, "task-test-fail", 1);

      // Should retry (executeCodingPhase called again) - removeTaskWorktree then createTaskWorktree
      expect(mockRemoveTaskWorktree).toHaveBeenCalledWith(repoPath, "task-test-fail");
      // Second call to createTaskWorktree for retry
      expect(mockCreateTaskWorktree.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it("retries when coding agent returns result.json status failed (coding_failure)", async () => {
      const task = {
        id: "task-coding-fail",
        title: "Task with coding failure",
        issue_type: "task",
        priority: 2,
        status: "open",
      };

      const wtPath = path.join(repoPath, "wt-coding-fail");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPath);
      mockGetActiveDir.mockReturnValue(
        path.join(repoPath, "wt-coding-fail", ".opensprint", "active", "task-coding-fail")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockReadResult.mockResolvedValue({
        status: "failed",
        summary: "Could not implement feature due to API limitations",
      });

      let onExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeCodingAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          onExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12345 };
        }
      );

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      mockBeadsSetCumulativeAttempts.mockResolvedValue(undefined);

      await onExit(1);
      await new Promise((r) => setTimeout(r, 400));

      expect(mockBeadsComment).toHaveBeenCalledWith(
        repoPath,
        "task-coding-fail",
        expect.stringContaining("Attempt 1 failed [coding_failure]")
      );
      expect(mockArchiveSession).toHaveBeenCalled();
      expect(mockBeadsSetCumulativeAttempts).toHaveBeenCalledWith(repoPath, "task-coding-fail", 1);

      // Retry should pass previousFailure to assembleTaskDirectory
      const assembleCalls = mockAssembleTaskDirectory.mock.calls;
      const retryCall = assembleCalls.find(
        (c: unknown[]) =>
          Array.isArray(c) &&
          c[2] &&
          typeof c[2] === "object" &&
          "previousFailure" in (c[2] as object) &&
          (c[2] as { previousFailure: string | null }).previousFailure !== null
      );
      expect(retryCall).toBeDefined();
      const retryConfig = retryCall![2] as { previousFailure: string | null };
      expect(retryConfig.previousFailure).toContain("API limitations");
    });

    it("retries with agent_crash when coding agent exits without result (exit 143)", async () => {
      const task = {
        id: "task-no-result",
        title: "Task with agent crash",
        issue_type: "task",
        priority: 2,
        status: "open",
      };

      const wtPath = path.join(repoPath, "wt-no-result");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPath);
      mockGetActiveDir.mockReturnValue(
        path.join(repoPath, "wt-no-result", ".opensprint", "active", "task-no-result")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockReadResult.mockResolvedValue(null);

      let onExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeCodingAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          onExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12345 };
        }
      );

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      await onExit(143);
      await new Promise((r) => setTimeout(r, 400));

      expect(mockBeadsComment).toHaveBeenCalledWith(
        repoPath,
        "task-no-result",
        expect.stringContaining("Attempt 1 failed [agent_crash]")
      );
      expect(mockArchiveSession).toHaveBeenCalled();
      expect(mockRemoveTaskWorktree).toHaveBeenCalledWith(repoPath, "task-no-result");
      expect(mockCreateTaskWorktree.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it("retries with no_result when coding agent exits without result (non-SIGTERM exit)", async () => {
      const task = {
        id: "task-no-result-other",
        title: "Task with unexpected exit",
        issue_type: "task",
        priority: 2,
        status: "open",
      };

      const wtPath = path.join(repoPath, "wt-no-result-other");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPath);
      mockGetActiveDir.mockReturnValue(
        path.join(repoPath, "wt-no-result-other", ".opensprint", "active", "task-no-result-other")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockReadResult.mockResolvedValue(null);

      let onExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeCodingAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          onExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12345 };
        }
      );

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      await onExit(1);
      await new Promise((r) => setTimeout(r, 400));

      expect(mockBeadsComment).toHaveBeenCalledWith(
        repoPath,
        "task-no-result-other",
        expect.stringContaining("Attempt 1 failed [no_result]")
      );
    });
  });

  describe("complexity-based agent routing", () => {
    const veryHighAgent = { type: "claude" as const, model: "claude-opus-4", cliCommand: null };
    const defaultAgent = { type: "claude" as const, model: "claude-sonnet-4", cliCommand: null };

    function setupTaskRun(taskId: string) {
      const task = {
        id: taskId,
        title: "Complexity routed task",
        issue_type: "task",
        priority: 2,
        status: "open",
      };

      const wtPath = path.join(repoPath, `wt-${taskId}`);

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPath);
      mockGetActiveDir.mockReturnValue(path.join(wtPath, ".opensprint", "active", taskId));
      mockAssembleTaskDirectory.mockResolvedValue(undefined);

      let onExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeCodingAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          onExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12345 };
        }
      );

      return { task, wtPath, getOnExit: () => onExit };
    }

    it("uses per-complexity agent override when complexity matches", async () => {
      mockGetSettings.mockResolvedValue({
        testFramework: "vitest",
        codingAgent: defaultAgent,
        codingAgentByComplexity: { very_high: veryHighAgent },
        reviewMode: "never",
      });
      mockGetPlanComplexityForTask.mockResolvedValue("very_high");

      const { wtPath } = setupTaskRun("task-complexity-vh");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      expect(mockInvokeCodingAgent).toHaveBeenCalled();
      const invokeCall = mockInvokeCodingAgent.mock.calls[0];
      const agentConfig = invokeCall[1];
      expect(agentConfig).toEqual(veryHighAgent);
    });

    it("falls back to default codingAgent when no complexity override", async () => {
      mockGetSettings.mockResolvedValue({
        testFramework: "vitest",
        codingAgent: defaultAgent,
        codingAgentByComplexity: { very_high: veryHighAgent },
        reviewMode: "never",
      });
      mockGetPlanComplexityForTask.mockResolvedValue("low");

      const { wtPath } = setupTaskRun("task-complexity-low");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      expect(mockInvokeCodingAgent).toHaveBeenCalled();
      const invokeCall = mockInvokeCodingAgent.mock.calls[0];
      const agentConfig = invokeCall[1];
      expect(agentConfig).toEqual(defaultAgent);
    });

    it("falls back to default codingAgent when complexity is undefined", async () => {
      mockGetSettings.mockResolvedValue({
        testFramework: "vitest",
        codingAgent: defaultAgent,
        codingAgentByComplexity: { very_high: veryHighAgent },
        reviewMode: "never",
      });
      mockGetPlanComplexityForTask.mockResolvedValue(undefined);

      const { wtPath } = setupTaskRun("task-complexity-undef");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      expect(mockInvokeCodingAgent).toHaveBeenCalled();
      const invokeCall = mockInvokeCodingAgent.mock.calls[0];
      const agentConfig = invokeCall[1];
      expect(agentConfig).toEqual(defaultAgent);
    });

    it("uses per-complexity override for review phase too", async () => {
      mockGetSettings.mockResolvedValue({
        testFramework: "vitest",
        codingAgent: defaultAgent,
        codingAgentByComplexity: { high: veryHighAgent },
        reviewMode: "always",
        deployment: {
          autoDeployOnEpicCompletion: false,
          autoResolveFeedbackOnTaskCompletion: false,
        },
      });
      mockGetPlanComplexityForTask.mockResolvedValue("high");

      const { wtPath, getOnExit } = setupTaskRun("task-complexity-review");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      mockReadResult
        .mockResolvedValueOnce({ status: "success", summary: "Done" })
        .mockResolvedValueOnce({ status: "approved", summary: "LGTM" });
      mockGetChangedFiles.mockResolvedValue([]);
      mockRunScopedTests.mockResolvedValue({ passed: 2, failed: 0, rawOutput: "ok" });
      mockCaptureBranchDiff.mockResolvedValue("diff");

      let reviewOnExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeReviewAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          reviewOnExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12346 };
        }
      );

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      const codingOnExit = getOnExit();
      await codingOnExit(0);
      await new Promise((r) => setTimeout(r, 300));

      expect(mockInvokeReviewAgent).toHaveBeenCalled();
      const reviewCall = mockInvokeReviewAgent.mock.calls[0];
      const reviewAgentConfig = reviewCall[1];
      expect(reviewAgentConfig).toEqual(veryHighAgent);

      mockBeadsShow.mockResolvedValue({
        id: "task-complexity-review",
        title: "Complexity routed task",
        issue_type: "task",
        priority: 2,
        status: "in_progress",
      });
      mockCreateSession.mockResolvedValue({ id: "sess-1" });
      mockArchiveSession.mockResolvedValue(undefined);

      await reviewOnExit(0);
      await new Promise((r) => setTimeout(r, 300));
    });
  });

  // ─── Crash recovery persist/restore round-trip ───
  describe("crash recovery - persistState/restoreState round-trip", () => {
    it("persists state with correct structure when task starts and can be restored", async () => {
      const task = {
        id: "task-persist-1",
        title: "Task for persist test",
        issue_type: "task",
        priority: 2,
        status: "open",
      };

      const wtPath = path.join(repoPath, "wt-persist");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPath);
      mockGetActiveDir.mockReturnValue(
        path.join(wtPath, ".opensprint", "active", "task-persist-1")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);

      let capturedPersistedState: unknown = null;
      mockWriteJsonAtomic.mockImplementation(async (filePath: string, data: unknown) => {
        capturedPersistedState = data;
      });

      mockInvokeCodingAgent.mockReturnValue({
        kill: vi.fn(),
        pid: 12345,
      });

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      expect(mockWriteJsonAtomic).toHaveBeenCalled();
      expect(capturedPersistedState).toBeDefined();
      const persisted = capturedPersistedState as Record<string, unknown>;
      expect(persisted.projectId).toBe(projectId);
      expect(persisted.currentTaskId).toBe("task-persist-1");
      expect(persisted.currentPhase).toBe("coding");
      expect(persisted.branchName).toBe("opensprint/task-persist-1");
      expect(persisted.attempt).toBe(1);
      expect(persisted.agentPid).toBe(12345);
      expect(persisted.lastTransition).toBeDefined();
      expect(typeof persisted.lastTransition).toBe("string");
    });

    it("restores from persisted state after simulated crash with in-progress task", async () => {
      const persistedState = {
        projectId,
        currentTaskId: "task-roundtrip",
        currentTaskTitle: "Round-trip task",
        currentPhase: "coding" as const,
        branchName: "opensprint/task-roundtrip",
        worktreePath: null,
        agentPid: 999999999,
        attempt: 2,
        startedAt: new Date().toISOString(),
        lastTransition: new Date().toISOString(),
        lastOutputTimestamp: null,
        queueDepth: 1,
        totalDone: 3,
        totalFailed: 0,
      };

      const statePath = path.join(repoPath, OPENSPRINT_PATHS.orchestratorState);
      await fs.writeFile(statePath, JSON.stringify(persistedState), "utf-8");

      mockGetCommitCountAhead.mockResolvedValue(0);
      mockCaptureBranchDiff.mockResolvedValue("");

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 150));

      const status = await orchestrator.getStatus(projectId);
      expect(status.totalDone).toBe(3);
      expect(status.totalFailed).toBe(1);
      expect(mockBeadsUpdate).toHaveBeenCalledWith(repoPath, "task-roundtrip", {
        status: "open",
        assignee: "",
      });
    });

    it("round-trips persistState to disk and loadPersistedState restores all fields", async () => {
      const task = {
        id: "task-roundtrip-2",
        title: "Round-trip persist/load",
        issue_type: "task",
        priority: 2,
        status: "open",
      };

      const wtPath = path.join(repoPath, "wt-roundtrip");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPath);
      mockGetActiveDir.mockReturnValue(
        path.join(wtPath, ".opensprint", "active", "task-roundtrip-2")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);

      mockWriteJsonAtomic.mockImplementation(async (filePath: string, data: unknown) => {
        if (filePath.includes(OPENSPRINT_PATHS.orchestratorState)) {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, JSON.stringify(data), "utf-8");
        }
      });

      mockInvokeCodingAgent.mockReturnValue({ kill: vi.fn(), pid: 12345 });

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      const statePath = path.join(repoPath, OPENSPRINT_PATHS.orchestratorState);
      const raw = await fs.readFile(statePath, "utf-8");
      const loaded = JSON.parse(raw) as Record<string, unknown>;

      expect(loaded.projectId).toBe(projectId);
      expect(loaded.currentTaskId).toBe("task-roundtrip-2");
      expect(loaded.currentPhase).toBe("coding");
      expect(loaded.branchName).toBe("opensprint/task-roundtrip-2");
      expect(loaded.attempt).toBe(1);
      expect(loaded.agentPid).toBe(12345);
      expect(loaded.lastTransition).toBeDefined();
      expect(typeof loaded.lastTransition).toBe("string");
      expect(loaded.queueDepth).toBeDefined();
      expect(loaded.totalDone).toBeDefined();
      expect(loaded.totalFailed).toBeDefined();
    });
  });

  // ─── Progressive backoff / infra vs quality ───
  describe("progressive backoff - infra vs quality failure distinction", () => {
    it("quality failure (test_failure) at attempt 1 retries immediately without demotion", async () => {
      const task = {
        id: "task-quality-fail",
        title: "Task with test failure",
        issue_type: "task",
        priority: 2,
        status: "open",
      };

      const wtPath = path.join(repoPath, "wt-quality");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPath);
      mockGetActiveDir.mockReturnValue(
        path.join(wtPath, ".opensprint", "active", "task-quality-fail")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockGetChangedFiles.mockResolvedValue([]);
      mockReadResult.mockResolvedValue({ status: "success", summary: "Done" });
      mockRunScopedTests.mockResolvedValue({
        passed: 1,
        failed: 2,
        rawOutput: "2 tests failed",
      });

      let onExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeCodingAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          onExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12345 };
        }
      );

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      await onExit(0);
      await new Promise((r) => setTimeout(r, 400));

      expect(mockBeadsComment).toHaveBeenCalledWith(
        repoPath,
        "task-quality-fail",
        expect.stringContaining("[test_failure]")
      );
      expect(mockBeadsSetCumulativeAttempts).toHaveBeenCalledWith(repoPath, "task-quality-fail", 1);
      expect(mockRemoveTaskWorktree).toHaveBeenCalledWith(repoPath, "task-quality-fail");
      expect(mockDeleteBranch).not.toHaveBeenCalled();
    });

    it("quality failure (review_rejection) triggers retry with review feedback", async () => {
      const task = {
        id: "task-review-reject",
        title: "Task with review rejection",
        issue_type: "task",
        priority: 2,
        status: "open",
      };

      const wtPath = path.join(repoPath, "wt-review-reject");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      mockGetSettings.mockResolvedValue({
        testFramework: "vitest",
        codingAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
        reviewMode: "always",
        deployment: {
          autoDeployOnEpicCompletion: false,
          autoResolveFeedbackOnTaskCompletion: false,
        },
      });

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPath);
      mockGetActiveDir.mockReturnValue(
        path.join(wtPath, ".opensprint", "active", "task-review-reject")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockGetChangedFiles.mockResolvedValue([]);
      mockRunScopedTests.mockResolvedValue({ passed: 2, failed: 0, rawOutput: "ok" });
      mockCaptureBranchDiff.mockResolvedValue("diff");

      mockReadResult
        .mockResolvedValueOnce({ status: "success", summary: "Implemented" })
        .mockResolvedValueOnce({
          status: "rejected",
          summary: "Missing tests",
          issues: ["Add unit tests"],
        });

      let codingOnExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeCodingAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          codingOnExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12345 };
        }
      );

      let reviewOnExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeReviewAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          reviewOnExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12346 };
        }
      );

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));
      await codingOnExit(0);
      await new Promise((r) => setTimeout(r, 300));

      mockCreateSession.mockResolvedValue({ id: "sess-1" });
      mockArchiveSession.mockResolvedValue(undefined);

      await reviewOnExit(0);
      await new Promise((r) => setTimeout(r, 400));

      expect(mockBeadsComment).toHaveBeenCalledWith(
        repoPath,
        "task-review-reject",
        expect.stringContaining("Review rejected (attempt 1)")
      );
      expect(mockBeadsSetCumulativeAttempts).toHaveBeenCalledWith(
        repoPath,
        "task-review-reject",
        1
      );
    });

    it("demotes task at BACKOFF_FAILURE_THRESHOLD (attempt 3) - priority increase", async () => {
      const task = {
        id: "task-demotion",
        title: "Task for demotion",
        issue_type: "task",
        priority: 2,
        status: "open",
      };

      const wtPath = path.join(repoPath, "wt-demotion");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPath);
      mockGetActiveDir.mockReturnValue(path.join(wtPath, ".opensprint", "active", "task-demotion"));
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockGetChangedFiles.mockResolvedValue([]);
      mockReadResult.mockResolvedValue({ status: "success", summary: "Done" });
      mockRunScopedTests.mockResolvedValue({
        passed: 1,
        failed: 2,
        rawOutput: "2 tests failed",
      });

      let onExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeCodingAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          onExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12345 };
        }
      );

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      mockBeadsSetCumulativeAttempts.mockResolvedValue(undefined);

      await onExit(0);
      await new Promise((r) => setTimeout(r, 400));

      mockBeadsGetCumulativeAttempts.mockResolvedValue(1);

      await onExit(0);
      await new Promise((r) => setTimeout(r, 400));

      mockBeadsGetCumulativeAttempts.mockResolvedValue(2);

      await onExit(0);
      await new Promise((r) => setTimeout(r, 500));

      expect(mockBeadsUpdate).toHaveBeenCalledWith(repoPath, "task-demotion", {
        status: "open",
        assignee: "",
        priority: 3,
      });
      expect(mockDeleteBranch).toHaveBeenCalledWith(repoPath, "opensprint/task-demotion");
      expect(mockBroadcastToProject).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          type: "agent.completed",
          taskId: "task-demotion",
          status: "failed",
        })
      );
    });

    it("blocks task at MAX_PRIORITY_BEFORE_BLOCK (4) after 3 failures", async () => {
      const task = {
        id: "task-block-max",
        title: "Task at max priority",
        issue_type: "task",
        priority: 4,
        status: "open",
      };

      const wtPath = path.join(repoPath, "wt-block-max");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPath);
      mockGetActiveDir.mockReturnValue(
        path.join(wtPath, ".opensprint", "active", "task-block-max")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockGetChangedFiles.mockResolvedValue([]);
      mockReadResult.mockResolvedValue({ status: "success", summary: "Done" });
      mockRunScopedTests.mockResolvedValue({
        passed: 1,
        failed: 2,
        rawOutput: "2 tests failed",
      });

      let onExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeCodingAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          onExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12345 };
        }
      );

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      mockBeadsSetCumulativeAttempts.mockResolvedValue(undefined);

      await onExit(0);
      await new Promise((r) => setTimeout(r, 400));

      mockBeadsGetCumulativeAttempts.mockResolvedValue(1);

      await onExit(0);
      await new Promise((r) => setTimeout(r, 400));

      mockBeadsGetCumulativeAttempts.mockResolvedValue(2);

      await onExit(0);
      await new Promise((r) => setTimeout(r, 500));

      expect(mockBeadsUpdate).toHaveBeenCalledWith(repoPath, "task-block-max", {
        status: "blocked",
        assignee: "",
      });
      expect(mockBroadcastToProject).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          type: "task.blocked",
          taskId: "task-block-max",
        })
      );
    });
  });

  // ─── MAX_INFRA_RETRIES (2 free retries) ───
  describe("infrastructure retry counting - MAX_INFRA_RETRIES", () => {
    it("agent_crash gets 2 free retries before counting toward backoff", async () => {
      const task = {
        id: "task-infra-retries",
        title: "Task with agent crashes",
        issue_type: "task",
        priority: 2,
        status: "open",
      };

      const wtPath = path.join(repoPath, "wt-infra");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPath);
      mockGetActiveDir.mockReturnValue(
        path.join(wtPath, ".opensprint", "active", "task-infra-retries")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockReadResult.mockResolvedValue(null);

      let onExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeCodingAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          onExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12345 };
        }
      );

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      await onExit(143);
      await new Promise((r) => setTimeout(r, 400));

      expect(mockBeadsSetCumulativeAttempts).not.toHaveBeenCalled();
      expect(mockBeadsComment).toHaveBeenCalledWith(
        repoPath,
        "task-infra-retries",
        expect.stringContaining("[agent_crash]")
      );
      expect(mockCreateTaskWorktree.mock.calls.length).toBeGreaterThanOrEqual(2);

      await onExit(143);
      await new Promise((r) => setTimeout(r, 400));

      expect(mockCreateTaskWorktree.mock.calls.length).toBeGreaterThanOrEqual(3);

      await onExit(143);
      await new Promise((r) => setTimeout(r, 400));

      expect(mockBeadsSetCumulativeAttempts).toHaveBeenCalledWith(
        repoPath,
        "task-infra-retries",
        3
      );
    });
  });

  // ─── Watchdog timeout (WATCHDOG_INTERVAL_MS = 60s) ───
  describe("watchdog timeout", () => {
    it("watchdog triggers nudge at 60s interval", async () => {
      vi.useFakeTimers();

      mockBeadsReady.mockResolvedValue([]);

      await orchestrator.ensureRunning(projectId);
      await vi.advanceTimersByTimeAsync(0);

      const statusCallsBefore = mockBroadcastToProject.mock.calls.filter(
        (c: [string, { type?: string }]) => c[1]?.type === "execute.status"
      ).length;

      await vi.advanceTimersByTimeAsync(59_000);
      const statusCallsAfter59s = mockBroadcastToProject.mock.calls.filter(
        (c: [string, { type?: string }]) => c[1]?.type === "execute.status"
      ).length;

      await vi.advanceTimersByTimeAsync(2_000);
      const statusCallsAfter61s = mockBroadcastToProject.mock.calls.filter(
        (c: [string, { type?: string }]) => c[1]?.type === "execute.status"
      ).length;

      expect(statusCallsAfter59s).toBe(statusCallsBefore);
      expect(statusCallsAfter61s).toBeGreaterThan(statusCallsBefore);

      vi.useRealTimers();
    });

    it("watchdog triggers nudge when loop is idle and can restart loop", async () => {
      vi.useFakeTimers();

      mockBeadsReady.mockResolvedValue([]);

      await orchestrator.ensureRunning(projectId);

      const initialCalls = mockBroadcastToProject.mock.calls.filter(
        (c: [string, { type?: string }]) => c[1]?.type === "execute.status"
      ).length;

      await vi.advanceTimersByTimeAsync(61_000);

      const afterCalls = mockBroadcastToProject.mock.calls.filter(
        (c: [string, { type?: string }]) => c[1]?.type === "execute.status"
      ).length;

      expect(afterCalls).toBeGreaterThan(initialCalls);

      vi.useRealTimers();
    });
  });

  // ─── Multi-project state isolation ───
  describe("multi-project orchestration - state isolation", () => {
    it("ensures state isolation between projects", async () => {
      const projectA = "project-a";
      const projectB = "project-b";
      const repoPathA = path.join(repoPath, "repo-a");
      const repoPathB = path.join(repoPath, "repo-b");
      await fs.mkdir(path.join(repoPathA, ".opensprint"), { recursive: true });
      await fs.mkdir(path.join(repoPathB, ".opensprint"), { recursive: true });

      mockGetProject.mockImplementation((id: string) =>
        Promise.resolve({
          id,
          repoPath: id === projectA ? repoPathA : repoPathB,
        })
      );
      mockGetRepoPath.mockImplementation((id: string) =>
        Promise.resolve(id === projectA ? repoPathA : repoPathB)
      );

      mockBeadsReady.mockResolvedValue([]);

      await orchestrator.ensureRunning(projectA);
      await orchestrator.ensureRunning(projectB);

      const statusA = await orchestrator.getStatus(projectA);
      const statusB = await orchestrator.getStatus(projectB);

      expect(statusA).toBeDefined();
      expect(statusB).toBeDefined();
      expect(statusA.currentTask).toBeNull();
      expect(statusB.currentTask).toBeNull();

      mockBeadsReady.mockResolvedValue([
        {
          id: "task-a",
          title: "Task A",
          issue_type: "task",
          priority: 2,
          status: "open",
        },
      ]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(path.join(repoPathA, "wt-a"));
      mockGetActiveDir.mockReturnValue(
        path.join(repoPathA, "wt-a", ".opensprint", "active", "task-a")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);

      mockInvokeCodingAgent.mockReturnValue({ kill: vi.fn(), pid: 12345 });

      orchestrator.nudge(projectA);
      await new Promise((r) => setTimeout(r, 200));

      const statusAAfter = await orchestrator.getStatus(projectA);
      const statusBAfter = await orchestrator.getStatus(projectB);

      expect(statusAAfter.currentTask).toBe("task-a");
      expect(statusBAfter.currentTask).toBeNull();

      orchestrator.stopProject(projectA);
      orchestrator.stopProject(projectB);
    });
  });

  // ─── Task selection priority and blocked handling ───
  describe("task selection - priority and blocked handling", () => {
    it("filters out blocked tasks from ready list", async () => {
      mockBeadsReady.mockResolvedValue([
        {
          id: "task-blocked",
          title: "Blocked",
          issue_type: "task",
          priority: 2,
          status: "blocked",
        },
        { id: "task-ready", title: "Ready", issue_type: "task", priority: 2, status: "open" },
      ]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(path.join(repoPath, "wt-ready"));
      mockGetActiveDir.mockReturnValue(
        path.join(repoPath, "wt-ready", ".opensprint", "active", "task-ready")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockInvokeCodingAgent.mockReturnValue({ kill: vi.fn(), pid: 12345 });

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 200));

      expect(mockBeadsUpdate).toHaveBeenCalledWith(
        repoPath,
        "task-ready",
        expect.objectContaining({ status: "in_progress" })
      );
      expect(mockBeadsUpdate).not.toHaveBeenCalledWith(repoPath, "task-blocked", expect.anything());
    });

    it("filters out epics and plan approval gate tasks", async () => {
      mockBeadsReady.mockResolvedValue([
        { id: "epic-1", title: "Epic", issue_type: "epic", priority: 3, status: "open" },
        {
          id: "task-1.0",
          title: "Plan approval gate",
          issue_type: "task",
          priority: 2,
          status: "open",
        },
        {
          id: "task-1.1",
          title: "Implement feature",
          issue_type: "task",
          priority: 2,
          status: "open",
        },
      ]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(path.join(repoPath, "wt-1.1"));
      mockGetActiveDir.mockReturnValue(
        path.join(repoPath, "wt-1.1", ".opensprint", "active", "task-1.1")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockInvokeCodingAgent.mockReturnValue({ kill: vi.fn(), pid: 12345 });

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 200));

      expect(mockBeadsUpdate).toHaveBeenCalledWith(
        repoPath,
        "task-1.1",
        expect.objectContaining({ status: "in_progress" })
      );
    });

    it("picks first task with all blockers closed", async () => {
      mockBeadsReady.mockResolvedValue([
        { id: "task-blocked", title: "Blocked", issue_type: "task", priority: 1, status: "open" },
        { id: "task-ready", title: "Ready", issue_type: "task", priority: 2, status: "open" },
      ]);
      mockBeadsAreAllBlockersClosed.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(path.join(repoPath, "wt-ready"));
      mockGetActiveDir.mockReturnValue(
        path.join(repoPath, "wt-ready", ".opensprint", "active", "task-ready")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockInvokeCodingAgent.mockReturnValue({ kill: vi.fn(), pid: 12345 });

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 200));

      expect(mockBeadsUpdate).toHaveBeenCalledWith(
        repoPath,
        "task-ready",
        expect.objectContaining({ status: "in_progress" })
      );
    });
  });

  // ─── Agent completion - merge conflict failure path ───
  describe("agent completion - merge conflict failure path", () => {
    it("handles merge_conflict failure type and triggers retry", async () => {
      const task = {
        id: "task-merge-fail",
        title: "Task with merge conflict",
        issue_type: "task",
        priority: 2,
        status: "open",
      };

      const wtPath = path.join(repoPath, "wt-merge");
      await fs.mkdir(path.join(wtPath, "node_modules"), { recursive: true });

      mockBeadsReady.mockResolvedValue([task]);
      mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
      mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
      mockCreateTaskWorktree.mockResolvedValue(wtPath);
      mockGetActiveDir.mockReturnValue(
        path.join(wtPath, ".opensprint", "active", "task-merge-fail")
      );
      mockAssembleTaskDirectory.mockResolvedValue(undefined);
      mockGetChangedFiles.mockResolvedValue([]);
      mockReadResult.mockResolvedValue({ status: "success", summary: "Done" });
      mockRunScopedTests.mockResolvedValue({ passed: 2, failed: 0, rawOutput: "ok" });
      mockCommitWip.mockResolvedValue(undefined);

      mockGitQueueEnqueueAndWait.mockRejectedValue(
        new RepoConflictError(["conflict.txt"])
      );
      mockVerifyMerge.mockResolvedValue(false);

      let onExit: (code: number | null) => Promise<void> = async () => {};
      mockInvokeCodingAgent.mockImplementation(
        (_p: string, _c: unknown, opts: { onExit?: (code: number | null) => Promise<void> }) => {
          onExit = opts.onExit ?? (async () => {});
          return { kill: vi.fn(), pid: 12345 };
        }
      );

      await orchestrator.ensureRunning(projectId);
      await new Promise((r) => setTimeout(r, 300));

      await onExit(0);
      await new Promise((r) => setTimeout(r, 500));

      expect(mockBeadsComment).toHaveBeenCalledWith(
        repoPath,
        "task-merge-fail",
        expect.stringContaining("[merge_conflict]")
      );
    });
  });
});
