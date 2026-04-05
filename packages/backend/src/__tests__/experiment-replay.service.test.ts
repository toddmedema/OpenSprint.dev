import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ExperimentReplayService,
  DEFAULT_MAX_REPLAY_SESSIONS,
  type ReplayAgentRunner,
} from "../services/experiment-replay.service.js";
import type { BehaviorExperimentCandidateBundle } from "../services/self-improvement-experiment.service.js";

function makeCandidateBundle(
  overrides?: Partial<BehaviorExperimentCandidateBundle>
): BehaviorExperimentCandidateBundle {
  return {
    versionType: "candidate",
    minedSessionIds: [1, 2],
    runId: "run-1",
    generalInstructionDiff: "diff",
    roleInstructionDiffs: {},
    promptTemplateDiffs: {
      coder: "diff-c",
      reviewer: "diff-r",
      finalReview: "diff-f",
      selfImprovement: "diff-s",
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAgentRunner(impl?: Partial<ReplayAgentRunner>): ReplayAgentRunner {
  return {
    run: vi.fn().mockImplementation(async () => ({
      success: true,
      retryCount: 0,
      reviewPassed: true,
      latencyMs: 100,
      costUsd: 0.01,
    })),
    ...impl,
  };
}

function makeBranchManagerMock() {
  return {
    createTaskWorktree: vi.fn().mockImplementation(async (_repo: string, _taskId: string) => {
      return "/tmp/opensprint-worktrees/fake-wt";
    }),
    prepareWorktreeForRemoval: vi.fn().mockResolvedValue(undefined),
    removeTaskWorktree: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ExperimentReplayService", () => {
  let branchManager: ReturnType<typeof makeBranchManagerMock>;
  let service: ExperimentReplayService;

  beforeEach(() => {
    vi.clearAllMocks();
    branchManager = makeBranchManagerMock();
    service = new ExperimentReplayService(branchManager as never);
  });

  it("returns empty result when no session IDs are provided", async () => {
    const runner = makeAgentRunner();
    const result = await service.runReplay({
      projectId: "proj-1",
      repoPath: "/repo",
      runId: "run-1",
      sessionIds: [],
      candidateBundle: makeCandidateBundle(),
      agentRunner: runner,
    });

    expect(result.sampleSize).toBe(0);
    expect(result.sessions).toEqual([]);
    expect(result.baselineMetrics.taskSuccessRate).toBe(0);
    expect(result.candidateMetrics.taskSuccessRate).toBe(0);
    expect(branchManager.createTaskWorktree).not.toHaveBeenCalled();
  });

  it("creates and disposes worktrees for each session × variant", async () => {
    const runner = makeAgentRunner();
    const result = await service.runReplay({
      projectId: "proj-1",
      repoPath: "/repo",
      runId: "run-1",
      sessionIds: [10, 20],
      candidateBundle: makeCandidateBundle(),
      agentRunner: runner,
    });

    expect(result.sampleSize).toBe(2);
    expect(result.sessions).toHaveLength(2);
    // 2 sessions × 2 variants = 4 worktrees created + 4 disposed
    expect(branchManager.createTaskWorktree).toHaveBeenCalled();
    expect(branchManager.removeTaskWorktree).toHaveBeenCalled();
  });

  it("disposes worktrees even when agent runner throws", async () => {
    const runner = makeAgentRunner({
      run: vi.fn().mockRejectedValue(new Error("agent crashed")),
    });

    const result = await service.runReplay({
      projectId: "proj-1",
      repoPath: "/repo",
      runId: "run-1",
      sessionIds: [10],
      candidateBundle: makeCandidateBundle(),
      agentRunner: runner,
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.baseline.success).toBe(false);
    expect(result.sessions[0]!.baseline.error).toContain("agent crashed");
    expect(result.sessions[0]!.candidate.success).toBe(false);
    // Worktrees still disposed
    expect(branchManager.removeTaskWorktree).toHaveBeenCalled();
  });

  it("disposes worktrees even when worktree creation fails", async () => {
    branchManager.createTaskWorktree.mockRejectedValue(new Error("worktree creation failed"));
    const runner = makeAgentRunner();

    const result = await service.runReplay({
      projectId: "proj-1",
      repoPath: "/repo",
      runId: "run-1",
      sessionIds: [10],
      candidateBundle: makeCandidateBundle(),
      agentRunner: runner,
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.baseline.success).toBe(false);
    expect(result.sessions[0]!.baseline.error).toContain("worktree creation failed");
    // removeTaskWorktree is still called in the finally block
    expect(branchManager.removeTaskWorktree).toHaveBeenCalled();
  });

  it("caps sessions to maxSessions (default)", async () => {
    const manyIds = Array.from({ length: 20 }, (_, i) => i + 1);
    const runner = makeAgentRunner();

    const result = await service.runReplay({
      projectId: "proj-1",
      repoPath: "/repo",
      runId: "run-1",
      sessionIds: manyIds,
      candidateBundle: makeCandidateBundle(),
      agentRunner: runner,
    });

    expect(result.sampleSize).toBe(DEFAULT_MAX_REPLAY_SESSIONS);
    expect(result.sessions).toHaveLength(DEFAULT_MAX_REPLAY_SESSIONS);
  });

  it("caps sessions to custom maxSessions", async () => {
    const runner = makeAgentRunner();
    const result = await service.runReplay({
      projectId: "proj-1",
      repoPath: "/repo",
      runId: "run-1",
      sessionIds: [1, 2, 3, 4, 5],
      candidateBundle: makeCandidateBundle(),
      agentRunner: runner,
      maxSessions: 2,
    });

    expect(result.sampleSize).toBe(2);
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0]!.sessionId).toBe(1);
    expect(result.sessions[1]!.sessionId).toBe(2);
  });

  it("passes candidateBundle only to candidate variant", async () => {
    const runFn = vi.fn().mockImplementation(async () => ({
      success: true,
      retryCount: 0,
      reviewPassed: true,
      latencyMs: 50,
      costUsd: 0.01,
    }));
    const runner: ReplayAgentRunner = { run: runFn };
    const bundle = makeCandidateBundle();

    await service.runReplay({
      projectId: "proj-1",
      repoPath: "/repo",
      runId: "run-1",
      sessionIds: [10],
      candidateBundle: bundle,
      agentRunner: runner,
    });

    expect(runFn).toHaveBeenCalledTimes(2);
    const baselineCall = runFn.mock.calls.find(
      (c: { variant: string }[]) => c[0].variant === "baseline"
    );
    const candidateCall = runFn.mock.calls.find(
      (c: { variant: string }[]) => c[0].variant === "candidate"
    );
    expect(baselineCall).toBeDefined();
    expect(candidateCall).toBeDefined();
    expect(baselineCall![0].candidateBundle).toBeUndefined();
    expect(candidateCall![0].candidateBundle).toBe(bundle);
  });

  it("aggregates metrics correctly across sessions", async () => {
    let callCount = 0;
    const runner: ReplayAgentRunner = {
      run: vi.fn().mockImplementation(async ({ variant }) => {
        callCount++;
        if (variant === "baseline") {
          return {
            success: true,
            retryCount: 1,
            reviewPassed: true,
            latencyMs: 200,
            costUsd: 0.05,
          };
        }
        // Candidate: first session succeeds, second fails
        return {
          success: callCount <= 3,
          retryCount: 0,
          reviewPassed: callCount <= 3,
          latencyMs: 100,
          costUsd: 0.02,
        };
      }),
    };

    const result = await service.runReplay({
      projectId: "proj-1",
      repoPath: "/repo",
      runId: "run-1",
      sessionIds: [1, 2],
      candidateBundle: makeCandidateBundle(),
      agentRunner: runner,
    });

    // Baseline: 2/2 success, retryRate 1, reviewPassRate 1
    expect(result.baselineMetrics.taskSuccessRate).toBe(1);
    expect(result.baselineMetrics.retryRate).toBe(1);
    expect(result.baselineMetrics.reviewPassRate).toBe(1);
    expect(result.baselineMetrics.avgLatencyMs).toBe(200);
    expect(result.baselineMetrics.avgCostUsd).toBe(0.05);

    // Candidate: 1/2 success
    expect(result.candidateMetrics.taskSuccessRate).toBe(0.5);
    expect(result.candidateMetrics.avgLatencyMs).toBe(100);
    expect(result.candidateMetrics.avgCostUsd).toBe(0.02);
  });

  it("creates worktrees with correct keys and branch names", async () => {
    const runner = makeAgentRunner();

    await service.runReplay({
      projectId: "proj-1",
      repoPath: "/repo",
      runId: "run-42",
      sessionIds: [7],
      candidateBundle: makeCandidateBundle(),
      agentRunner: runner,
    });

    const createCalls = branchManager.createTaskWorktree.mock.calls;
    expect(createCalls).toHaveLength(2);

    // Baseline worktree
    expect(createCalls[0][0]).toBe("/repo");
    expect(createCalls[0][1]).toBe("replay-baseline-7-run-42");
    expect(createCalls[0][2]).toBe("main");
    expect(createCalls[0][3]).toEqual({
      worktreeKey: "replay-baseline-7-run-42",
      branchName: "opensprint/replay-baseline-7-run-42",
    });

    // Candidate worktree
    expect(createCalls[1][0]).toBe("/repo");
    expect(createCalls[1][1]).toBe("replay-candidate-7-run-42");
    expect(createCalls[1][2]).toBe("main");
    expect(createCalls[1][3]).toEqual({
      worktreeKey: "replay-candidate-7-run-42",
      branchName: "opensprint/replay-candidate-7-run-42",
    });
  });

  it("invokes onStageChange callbacks during replay", async () => {
    const runner = makeAgentRunner();
    const stages: string[] = [];

    await service.runReplay({
      projectId: "proj-1",
      repoPath: "/repo",
      runId: "run-1",
      sessionIds: [1],
      candidateBundle: makeCandidateBundle(),
      agentRunner: runner,
      onStageChange: (stage) => stages.push(stage),
    });

    expect(stages).toEqual(["replaying", "scoring"]);
  });

  it("uses custom baseBranch", async () => {
    const runner = makeAgentRunner();

    await service.runReplay({
      projectId: "proj-1",
      repoPath: "/repo",
      runId: "run-1",
      baseBranch: "develop",
      sessionIds: [1],
      candidateBundle: makeCandidateBundle(),
      agentRunner: runner,
    });

    const createCalls = branchManager.createTaskWorktree.mock.calls;
    expect(createCalls[0][2]).toBe("develop");
    expect(createCalls[1][2]).toBe("develop");
  });

  it("handles worktree disposal failure gracefully", async () => {
    branchManager.removeTaskWorktree.mockRejectedValue(new Error("cleanup failed"));
    const runner = makeAgentRunner();

    const result = await service.runReplay({
      projectId: "proj-1",
      repoPath: "/repo",
      runId: "run-1",
      sessionIds: [1],
      candidateBundle: makeCandidateBundle(),
      agentRunner: runner,
    });

    // Replay should still complete successfully despite cleanup errors
    expect(result.sampleSize).toBe(1);
    expect(result.sessions[0]!.baseline.success).toBe(true);
    expect(result.sessions[0]!.candidate.success).toBe(true);
  });

  it("returns correct sessionIds in results", async () => {
    const runner = makeAgentRunner();

    const result = await service.runReplay({
      projectId: "proj-1",
      repoPath: "/repo",
      runId: "run-1",
      sessionIds: [42, 99, 7],
      candidateBundle: makeCandidateBundle(),
      agentRunner: runner,
    });

    expect(result.sessions.map((s) => s.sessionId)).toEqual([42, 99, 7]);
  });

  describe("integration with self-improvement runner pipeline", () => {
    it("mocked agent produces differentiated baseline vs candidate results", async () => {
      const runner: ReplayAgentRunner = {
        run: vi.fn().mockImplementation(async ({ variant }) => {
          if (variant === "baseline") {
            return {
              success: true,
              retryCount: 2,
              reviewPassed: false,
              latencyMs: 500,
              costUsd: 0.1,
            };
          }
          return {
            success: true,
            retryCount: 0,
            reviewPassed: true,
            latencyMs: 300,
            costUsd: 0.05,
          };
        }),
      };

      const result = await service.runReplay({
        projectId: "proj-1",
        repoPath: "/repo",
        runId: "run-1",
        sessionIds: [1, 2, 3],
        candidateBundle: makeCandidateBundle(),
        agentRunner: runner,
      });

      expect(result.sampleSize).toBe(3);
      expect(result.baselineMetrics.taskSuccessRate).toBe(1);
      expect(result.baselineMetrics.retryRate).toBe(2);
      expect(result.baselineMetrics.reviewPassRate).toBe(0);
      expect(result.baselineMetrics.avgLatencyMs).toBe(500);
      expect(result.baselineMetrics.avgCostUsd).toBeCloseTo(0.1);

      expect(result.candidateMetrics.taskSuccessRate).toBe(1);
      expect(result.candidateMetrics.retryRate).toBe(0);
      expect(result.candidateMetrics.reviewPassRate).toBe(1);
      expect(result.candidateMetrics.avgLatencyMs).toBe(300);
      expect(result.candidateMetrics.avgCostUsd).toBeCloseTo(0.05);

      // Candidate is better in this scenario (lower retry, higher review pass, lower cost)
      expect(result.candidateMetrics.retryRate).toBeLessThan(result.baselineMetrics.retryRate!);
      expect(result.candidateMetrics.avgCostUsd).toBeLessThan(result.baselineMetrics.avgCostUsd!);
    });
  });
});
