/**
 * Context interfaces for PhaseExecutor and ResultHandler.
 * Avoids circular imports between orchestrator and extracted phase/result modules.
 */

import type { BeadsIssue } from "./beads.service.js";
import type { AgentConfig, TestResults } from "@opensprint/shared";

export type FailureType =
  | "test_failure"
  | "review_rejection"
  | "agent_crash"
  | "timeout"
  | "no_result"
  | "merge_conflict"
  | "coding_failure";

export interface RetryContext {
  previousFailure?: string;
  reviewFeedback?: string;
  useExistingBranch?: boolean;
  previousTestOutput?: string;
  previousDiff?: string;
  failureType?: FailureType;
}

/** Slot shape needed by executeCodingPhase; full AgentSlot from orchestrator */
export interface AgentSlotLike {
  taskId: string;
  taskTitle: string | null;
  branchName: string;
  worktreePath: string | null;
  attempt: number;
  phase: "coding" | "review";
  phaseResult: { codingDiff: string; codingSummary: string; testResults: TestResults | null; testOutput: string };
  infraRetries: number;
  agent: { outputLog: string[]; startedAt: string; killedDueToTimeout: boolean };
  timers: { clearAll: () => void };
}

/** Callbacks PhaseExecutor needs from ResultHandler (passed from Orchestrator) */
export interface PhaseExecutorCallbacks {
  handleCodingDone(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    branchName: string,
    exitCode: number | null
  ): Promise<void>;
  handleReviewDone(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    branchName: string,
    exitCode: number | null
  ): Promise<void>;
  handleTaskFailure(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    branchName: string,
    reason: string,
    testResults?: TestResults | null,
    failureType?: FailureType,
    reviewFeedback?: string
  ): Promise<void>;
}

/** Callbacks ResultHandler needs from PhaseExecutor (passed from Orchestrator) */
export interface ResultHandlerCallbacks {
  executeCodingPhase(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    slot: AgentSlotLike,
    retryContext?: RetryContext
  ): Promise<void>;
  executeReviewPhase(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    branchName: string
  ): Promise<void>;
}

/** GUPP-style assignment file shape (see AGENTS.md) */
export interface TaskAssignmentLike {
  taskId: string;
  projectId: string;
  phase: "coding" | "review";
  branchName: string;
  worktreePath: string;
  promptPath: string;
  agentConfig: AgentConfig;
  attempt: number;
  retryContext?: RetryContext;
  createdAt: string;
}
