import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RepoConflictError } from "../services/git-commit-queue.service.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { OrchestratorService, formatReviewFeedback } from "../services/orchestrator.service.js";
import type { ReviewAgentResult } from "@opensprint/shared";
import { OPENSPRINT_PATHS } from "@opensprint/shared";

// ─── Mocks ───

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
  mockFindOrphanedAssignments,
  mockListSessions,
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
  mockFindOrphanedAssignments: vi.fn(),
  mockListSessions: vi.fn(),
}));

vi.mock("../websocket/index.js", () => ({
  broadcastToProject: (...args: unknown[]) => mockBroadcastToProject(...args),
  sendAgentOutputToProject: (...args: unknown[]) => mockSendAgentOutputToProject(...args),
}));

vi.mock("../services/beads.service.js", () => ({
  BeadsService: vi.fn().mockImplementation(() => ({
    ready: mockBeadsReady,
    readyWithStatusMap: vi.fn().mockImplementation(async () => ({ tasks: await mockBeadsReady() })),
    getCumulativeAttemptsFromIssue: vi.fn().mockImplementation((issue: { labels?: string[] }) => {
      const labels = (issue?.labels ?? []) as string[];
      const attemptsLabel = labels.find((l: string) => /^attempts:\d+$/.test(l));
      if (!attemptsLabel) return 0;
      const n = parseInt(attemptsLabel.split(":")[1]!, 10);
      return Number.isNaN(n) ? 0 : n;
    }),
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
    listSessions: mockListSessions,
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

vi.mock("../services/crash-recovery.service.js", () => ({
  CrashRecoveryService: vi.fn().mockImplementation(() => ({
    findOrphanedAssignments: mockFindOrphanedAssignments,
  })),
}));

const mockListPendingFeedbackIds = vi.fn().mockResolvedValue([]);
const mockGetNextPendingFeedbackId = vi.fn().mockResolvedValue(null);
vi.mock("../services/feedback.service.js", () => ({
  FeedbackService: vi.fn().mockImplementation(() => ({
    listPendingFeedbackIds: (...args: unknown[]) => mockListPendingFeedbackIds(...args),
    getNextPendingFeedbackId: (...args: unknown[]) => mockGetNextPendingFeedbackId(...args),
    processFeedbackWithAnalyst: vi.fn().mockResolvedValue(undefined),
    removeFromInbox: vi.fn().mockResolvedValue(undefined),
    checkAutoResolveOnTaskDone: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ─── Tests ───

describe("OrchestratorService (slot-based model)", () => {
  let orchestrator: OrchestratorService;
  let repoPath: string;
  const projectId = "test-project-1";

  const defaultSettings = {
    testFramework: "vitest",
    codingAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
    planningAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
    reviewMode: "never",
    deployment: { autoDeployOnEpicCompletion: false, autoResolveFeedbackOnTaskCompletion: false },
    maxConcurrentCoders: 1,
  };

  const makeTask = (id: string, title = `Task ${id}`) => ({
    id,
    title,
    status: "open",
    priority: 2,
    issue_type: "task",
    type: "task",
    labels: [],
    assignee: null,
    description: "",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  });

  /**
   * Helper to simulate a full single-task dispatch:
   * beads.ready returns one task, agent lifecycle fires onDone callback with
   * a successful coding result.
   */
  function setupSingleTaskFlow(taskId = "task-1") {
    const task = makeTask(taskId);
    const wtPath = `/tmp/opensprint-worktrees/${taskId}`;

    mockBeadsReady.mockResolvedValue([task]);
    mockBeadsAreAllBlockersClosed.mockResolvedValue(true);
    mockBeadsGetCumulativeAttempts.mockResolvedValue(0);
    mockCreateTaskWorktree.mockResolvedValue(wtPath);
    mockGetActiveDir.mockReturnValue(`${wtPath}/.opensprint/active/${taskId}`);
    mockWriteJsonAtomic.mockResolvedValue(undefined);

    let capturedOnDone: ((code: number | null) => Promise<void>) | undefined;
    mockInvokeCodingAgent.mockImplementation(
      (_prompt: string, _config: unknown, opts: { onExit: (code: number | null) => void }) => {
        capturedOnDone = opts.onExit as (code: number | null) => Promise<void>;
        return { kill: vi.fn(), pid: 12345 };
      }
    );

    return { task, wtPath, getOnDone: () => capturedOnDone! };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    orchestrator = new OrchestratorService();

    repoPath = path.join(os.tmpdir(), `orchestrator-test-${Date.now()}`);
    await fs.mkdir(repoPath, { recursive: true });
    await fs.mkdir(path.join(repoPath, ".opensprint"), { recursive: true });

    mockGetProject.mockResolvedValue({ id: projectId });
    mockGetRepoPath.mockResolvedValue(repoPath);
    mockGetSettings.mockResolvedValue(defaultSettings);
    mockRecoverOrphanedTasks.mockResolvedValue({ recovered: [] });
    mockRecoverFromStaleHeartbeats.mockResolvedValue({ recovered: [] });
    mockFindOrphanedAssignments.mockResolvedValue([]);
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
    mockListSessions.mockResolvedValue([]);
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
    });

    it("handles missing summary gracefully", () => {
      const result = { status: "rejected" } as unknown as ReviewAgentResult;
      expect(formatReviewFeedback(result)).toBe(
        "Review rejected (no details provided by review agent)."
      );
    });
  });

  describe("ensureRunning", () => {
    it("returns status with empty activeTasks when idle", async () => {
      mockBeadsReady.mockResolvedValue([]);
      const status = await orchestrator.ensureRunning(projectId);
      expect(status.activeTasks).toEqual([]);
      expect(status.queueDepth).toBe(0);
    });

    it("runs GUPP crash recovery on startup", async () => {
      mockBeadsReady.mockResolvedValue([]);
      await orchestrator.ensureRunning(projectId);
      expect(mockFindOrphanedAssignments).toHaveBeenCalledWith(repoPath);
    });

    it("recovers orphaned assignments by requeueing tasks", async () => {
      mockBeadsReady.mockResolvedValue([]);
      mockFindOrphanedAssignments.mockResolvedValue([
        {
          taskId: "task-orphan",
          assignment: {
            taskId: "task-orphan",
            projectId,
            phase: "coding",
            branchName: "opensprint/task-orphan",
            worktreePath: "/tmp/wt",
            promptPath: "/tmp/wt/.opensprint/active/task-orphan/prompt.md",
            agentConfig: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
            attempt: 1,
            createdAt: new Date().toISOString(),
          },
        },
      ]);
      // Recovery uses listAll + id lookup instead of show per orphan
      const orphanTask = { id: "task-orphan", status: "in_progress" };
      mockBeadsListAll.mockResolvedValueOnce([orphanTask]);

      await orchestrator.ensureRunning(projectId);

      expect(mockBeadsUpdate).toHaveBeenCalledWith(repoPath, "task-orphan", {
        status: "open",
        assignee: "",
      });
    });
  });

  describe("single task dispatch (maxConcurrentCoders=1)", () => {
    it("creates a slot, spawns agent, writes assignment.json", async () => {
      const { task, wtPath } = setupSingleTaskFlow();
      mockBeadsReady.mockResolvedValueOnce([task]);

      await orchestrator.ensureRunning(projectId);

      // nudge() fires runLoop() without awaiting — flush microtask queue
      await vi.waitFor(() => {
        expect(mockWriteJsonAtomic).toHaveBeenCalled();
      });

      // Should broadcast execute.status with activeTasks
      expect(mockBroadcastToProject).toHaveBeenCalledWith(
        projectId,
        expect.objectContaining({
          type: "execute.status",
          activeTasks: expect.arrayContaining([
            expect.objectContaining({ taskId: "task-1", phase: "coding" }),
          ]),
        })
      );

      // Should write assignment.json
      expect(mockWriteJsonAtomic).toHaveBeenCalledWith(
        expect.stringContaining("assignment.json"),
        expect.objectContaining({
          taskId: "task-1",
          phase: "coding",
          branchName: "opensprint/task-1",
        })
      );
    });
  });

  describe("getStatus", () => {
    it("returns activeTasks array from current slots", async () => {
      mockBeadsReady.mockResolvedValue([]);
      await orchestrator.ensureRunning(projectId);
      const status = await orchestrator.getStatus(projectId);
      expect(status).toHaveProperty("activeTasks");
      expect(Array.isArray(status.activeTasks)).toBe(true);
    });
  });

  describe("getLiveOutput", () => {
    it("returns empty for unknown task", async () => {
      mockBeadsReady.mockResolvedValue([]);
      await orchestrator.ensureRunning(projectId);
      const output = await orchestrator.getLiveOutput(projectId, "nonexistent");
      expect(output).toBe("");
    });
  });

  describe("stopProject", () => {
    it("clears all slots and timers", async () => {
      mockBeadsReady.mockResolvedValue([]);
      await orchestrator.ensureRunning(projectId);
      orchestrator.stopProject(projectId);
      const status = await orchestrator.getStatus(projectId);
      expect(status.activeTasks).toEqual([]);
    });
  });

  describe("getActiveAgents", () => {
    it("returns empty array when no agents are running", async () => {
      mockBeadsReady.mockResolvedValue([]);
      await orchestrator.ensureRunning(projectId);
      const agents = await orchestrator.getActiveAgents(projectId);
      expect(agents).toEqual([]);
    });
  });
});
