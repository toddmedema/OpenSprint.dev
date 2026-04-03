import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => [a, b],
}));
vi.mock("../db/drizzle-schema-pg.js", () => ({ plansTable: {} }));
vi.mock("../websocket/index.js", () => ({
  broadcastToProject: vi.fn(),
}));
vi.mock("../services/notification.service.js", () => ({
  notificationService: { resolveRateLimitNotifications: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../services/agent-identity.service.js", () => ({
  agentIdentityService: { recordAttempt: vi.fn().mockResolvedValue(undefined) },
  buildAgentAttemptId: vi.fn().mockReturnValue("agent-id"),
}));
vi.mock("../services/event-log.service.js", () => ({
  eventLogService: { append: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../services/review-synthesizer.service.js", () => ({
  reviewSynthesizerService: { synthesize: vi.fn() },
}));

import {
  OrchestratorReviewService,
  type OrchestratorReviewHost,
} from "../services/orchestrator-review.service.js";
import type { PersistedOrchestratorTestStatus } from "../services/orchestrator-test-status.js";

function createMockHost(overrides?: Partial<OrchestratorReviewHost>): OrchestratorReviewHost {
  return {
    getState: vi.fn().mockReturnValue({ slots: new Map(), status: { queueDepth: 0 } }),
    cleanupSlotIfProjectGone: vi.fn().mockResolvedValue(true),
    readAssignmentForRun: vi.fn().mockResolvedValue(null),
    runAdaptiveValidation: vi.fn().mockResolvedValue({ passed: 1, failed: 0, rawOutput: "" }),
    runTaskWorktreeMergeGatesMaybeDeduped: vi.fn().mockResolvedValue(null),
    applyQualityGateFailure: vi.fn().mockReturnValue({ command: "test", reason: "fail" }),
    formatQualityGateFailureReason: vi.fn().mockReturnValue("Gate failed: test"),
    clearQualityGateDetail: vi.fn(),
    persistCounters: vi.fn().mockResolvedValue(undefined),
    onAgentStateChange: vi.fn().mockReturnValue(() => {}),
    branchManager: {
      commitWip: vi.fn().mockResolvedValue(undefined),
      captureBranchDiff: vi.fn().mockResolvedValue(""),
      captureUncommittedDiff: vi.fn().mockResolvedValue(""),
    } as unknown as OrchestratorReviewHost["branchManager"],
    sessionManager: {
      readRawResult: vi.fn().mockResolvedValue(null),
      createSession: vi.fn().mockResolvedValue({ id: "sess-1" }),
      archiveSession: vi.fn().mockResolvedValue(undefined),
      listSessions: vi.fn().mockResolvedValue([]),
    } as unknown as OrchestratorReviewHost["sessionManager"],
    projectService: {
      getSettings: vi.fn().mockResolvedValue({
        simpleComplexityAgent: { type: "claude", model: "claude-3" },
        reviewMode: "always",
      }),
    } as unknown as OrchestratorReviewHost["projectService"],
    taskStore: {
      update: vi.fn().mockResolvedValue(undefined),
    } as unknown as OrchestratorReviewHost["taskStore"],
    failureHandler: {
      handleTaskFailure: vi.fn().mockResolvedValue(undefined),
    } as unknown as OrchestratorReviewHost["failureHandler"],
    mergeCoordinator: {
      performMergeAndDone: vi.fn().mockResolvedValue(undefined),
    } as unknown as OrchestratorReviewHost["mergeCoordinator"],
    phaseExecutor: {
      executeReviewPhase: vi.fn().mockResolvedValue(undefined),
    } as unknown as OrchestratorReviewHost["phaseExecutor"],
    ...overrides,
  };
}

describe("OrchestratorReviewService", () => {
  let host: OrchestratorReviewHost;
  let service: OrchestratorReviewService;

  beforeEach(() => {
    host = createMockHost();
    service = new OrchestratorReviewService(host);
  });

  describe("toRecoveredTestOutcome", () => {
    it("returns null for pending status", () => {
      const status: PersistedOrchestratorTestStatus = { status: "pending" };
      expect(service.toRecoveredTestOutcome(status)).toBeNull();
    });

    it("returns passed outcome with results", () => {
      const status: PersistedOrchestratorTestStatus = {
        status: "passed",
        results: { passed: 5, failed: 0, total: 5, suites: 1 } as never,
      };
      const outcome = service.toRecoveredTestOutcome(status);
      expect(outcome).toEqual({
        status: "passed",
        results: { passed: 5, failed: 0, total: 5, suites: 1 },
      });
    });

    it("returns failed outcome with rawOutput and failureType", () => {
      const status: PersistedOrchestratorTestStatus = {
        status: "failed",
        rawOutput: "test output",
        failureType: "test_failure",
      };
      const outcome = service.toRecoveredTestOutcome(status);
      expect(outcome).toEqual({
        status: "failed",
        rawOutput: "test output",
        failureType: "test_failure",
      });
    });

    it("returns error outcome with errorMessage", () => {
      const status: PersistedOrchestratorTestStatus = {
        status: "error",
        errorMessage: "crash",
      };
      const outcome = service.toRecoveredTestOutcome(status);
      expect(outcome).toEqual({
        status: "error",
        errorMessage: "crash",
      });
    });
  });

  describe("applyRecoveredTestOutcome", () => {
    it("applies passed outcome to phaseResult", () => {
      const phaseResult = {
        codingDiff: "",
        codingSummary: "",
        testResults: null,
        testOutput: "",
        validationCommand: null as string | null,
        qualityGateDetail: null as null | undefined,
        mergeGateArtifactTaskWorktree: null as null | undefined,
      };
      const outcome = { status: "passed" as const, results: { passed: 2, failed: 0, total: 2, suites: 1 } as never };
      const status: PersistedOrchestratorTestStatus = { status: "passed", testCommand: "vitest" };
      service.applyRecoveredTestOutcome(phaseResult, outcome, status);
      expect(phaseResult.validationCommand).toBe("vitest");
      expect(phaseResult.testOutput).toBe("");
      expect(host.clearQualityGateDetail).toHaveBeenCalled();
    });

    it("applies failed outcome with error details", () => {
      const phaseResult = {
        codingDiff: "",
        codingSummary: "",
        testResults: null,
        testOutput: "",
        validationCommand: null as string | null,
        qualityGateDetail: null as null | undefined,
      };
      const outcome = { status: "failed" as const, rawOutput: "err output", results: null };
      const status: PersistedOrchestratorTestStatus = { status: "failed", testCommand: "jest" };
      service.applyRecoveredTestOutcome(phaseResult, outcome, status);
      expect(phaseResult.validationCommand).toBe("jest");
      expect(phaseResult.testOutput).toBe("err output");
    });
  });

  describe("clearRateLimitNotifications", () => {
    it("resolves rate limit notifications", async () => {
      await service.clearRateLimitNotifications("proj-1");
      const { notificationService: ns } = await import("../services/notification.service.js");
      expect(ns.resolveRateLimitNotifications).toHaveBeenCalledWith("proj-1");
    });
  });

  describe("buildReviewHistory", () => {
    it("returns empty string when no sessions", async () => {
      const result = await service.buildReviewHistory("/repo", "task-1");
      expect(result).toBe("");
    });

    it("formats rejected sessions", async () => {
      (host.sessionManager.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
        { attempt: 1, status: "rejected", failureReason: "Bug in logic" },
        { attempt: 2, status: "completed" },
        { attempt: 3, status: "rejected", failureReason: "Missing tests" },
      ]);
      const result = await service.buildReviewHistory("/repo", "task-1");
      expect(result).toContain("Attempt 1 — Rejected");
      expect(result).toContain("Bug in logic");
      expect(result).toContain("Attempt 3 — Rejected");
      expect(result).toContain("Missing tests");
      expect(result).not.toContain("Attempt 2");
    });
  });

  describe("executeReviewPhase", () => {
    it("delegates to phaseExecutor", async () => {
      const task = { id: "t-1" } as never;
      await service.executeReviewPhase("proj-1", "/repo", task, "branch-1");
      expect(host.phaseExecutor.executeReviewPhase).toHaveBeenCalledWith(
        "proj-1",
        "/repo",
        task,
        "branch-1",
        undefined,
        undefined
      );
    });
  });
});
