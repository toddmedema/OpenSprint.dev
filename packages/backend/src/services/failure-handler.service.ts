/**
 * FailureHandler — progressive backoff, retry logic, and task blocking.
 * Extracted from OrchestratorService for clarity and single-responsibility.
 *
 * Pure failure policy: "given N failures of type T, what happens next?"
 * Delegates retry execution back to the host via callbacks.
 */

import type { AgentConfig, ServerEvent, TestResults } from "@opensprint/shared";
import {
  AGENT_INACTIVITY_TIMEOUT_MS,
  BACKOFF_FAILURE_THRESHOLD,
  getProviderForAgentType,
  getRemediationForFailureType,
  MAX_PRIORITY_BEFORE_BLOCK,
  TASK_COMPLEXITY_MAX,
  TASK_COMPLEXITY_MIN,
} from "@opensprint/shared";
import type { StoredTask } from "./task-store.service.js";
import type {
  FailureType,
  RetryContext,
  RetryFailureHistoryEntry,
  RetryQualityGateDetail,
} from "./orchestrator-phase-context.js";
import {
  agentIdentityService,
  buildAgentAttemptId,
  type AttemptOutcome,
} from "./agent-identity.service.js";
import { eventLogService } from "./event-log.service.js";
import { broadcastToProject } from "../websocket/index.js";
import { createLogger } from "../utils/logger.js";
import { ErrorCodes } from "../middleware/error-codes.js";
import { classifyAgentApiError, type AgentApiErrorKind } from "../utils/error-utils.js";
import { isLostInternetMessage } from "../utils/connectivity-check.js";
import { notificationService } from "./notification.service.js";
import { markProviderOutageBackoff } from "./provider-outage-backoff.service.js";
import { buildTaskLastExecutionSummary, compactExecutionText } from "./task-execution-summary.js";
import { resolveBaseBranch } from "../utils/git-repo-state.js";
import { buildTestFailureRetrySummary } from "./orchestrator-test-status.js";
import {
  isMeaningfulNoResultFragment,
  extractNoResultReasonFromOutput,
  type NoResultReasonCode,
} from "./no-result-reason.service.js";

const log = createLogger("failure-handler");

const INFRA_FAILURE_TYPES: FailureType[] = ["agent_crash", "timeout", "merge_conflict"];
const MAX_INFRA_RETRIES = 2;
const NO_RESULT_TAIL_LINES = 8;
const NO_RESULT_REASON_LIMIT = 1200;
const NEXT_RETRY_CONTEXT_KEY = "next_retry_context";
const RETRY_CONTEXT_FAILURE_LIMIT = 2000;
const RETRY_CONTEXT_REVIEW_LIMIT = 4000;
const RETRY_CONTEXT_TEST_OUTPUT_LIMIT = 2500;
const RETRY_CONTEXT_TEST_FAILURES_LIMIT = 2000;
const RETRY_CONTEXT_DIFF_LIMIT = 6000;
const FAILURE_HISTORY_SUMMARY_LIMIT = 200;
const FAILURE_HISTORY_MAX_ENTRIES = 12;
const FAILURE_RETRY_CAPS: Partial<Record<FailureType, number>> = {
  no_result: 3,
  merge_quality_gate: 3,
  environment_setup: 1,
};
const RUNAWAY_WINDOW_MS = 2 * 60 * 60 * 1000;
const RUNAWAY_MAX_ATTEMPTS_PER_WINDOW = 6;
const RUNAWAY_MAX_REPEAT_SIGNATURE = 3;
const FAILURE_DIAGNOSTIC_OUTPUT_LIMIT = 1800;
const FAILURE_DIAGNOSTIC_LINE_LIMIT = 300;
const FAILURE_DIAGNOSTIC_REASON_PATTERNS: RegExp[] = [
  /^tests? failed:/i,
  /^command failed(?::|\b)/i,
  /^coding failed:/i,
  /^review failed:/i,
  /^review rejected\b/i,
  /^agent exited with code\b/i,
];
const FAILURE_DIAGNOSTIC_NOISE_PATTERNS: RegExp[] = [
  /^> [^ ].*/i,
  /^npm (error|err!)/i,
  /^lifecycle script .* failed/i,
  /^exit code \d+/i,
  /^error: command failed/i,
  /^at\s+\S+/i,
  /^node:/i,
  /^caused by:/i,
  /^⎯+/,
  /^[-=]{3,}$/,
];
const CURSOR_PROVIDER_OUTAGE_PATTERNS: RegExp[] = [
  /failed to reach the cursor api/i,
  /\bcursor api\b.*\b(service unavailable|unavailable|connection error|failed)\b/i,
  /\bcursor api error\b.*\b(fetch failed|socket hang up|econnreset|econnrefused|enotfound|eai_again|unable to connect|connection error)\b/i,
];

const GENERIC_PROVIDER_OUTAGE_PATTERNS: RegExp[] = [
  /\brate limit\b/i,
  /\b429\b.*\b(too many requests|rate)\b/i,
  /\btoo many requests\b/i,
  /\bquota exceeded\b/i,
  /\binsufficient.credits\b/i,
];

type FailureDiagnosticDetail = {
  command: string | null;
  reason: string | null;
  outputSnippet: string | null;
  worktreePath: string | null;
  firstErrorLine: string | null;
};

export interface FailureHandlerHost {
  getState(projectId: string): {
    slots: Map<string, FailureSlot>;
    status: { totalFailed: number; queueDepth: number };
  };
  taskStore: {
    comment(projectId: string, taskId: string, text: string): Promise<void>;
    update(projectId: string, taskId: string, fields: Record<string, unknown>): Promise<void>;
    removeLabel?(projectId: string, taskId: string, label: string): Promise<void>;
    sync(repoPath: string): Promise<void>;
    setCumulativeAttempts(
      projectId: string,
      taskId: string,
      attempts: number,
      opts: { currentLabels: string[] }
    ): Promise<void>;
  };
  branchManager: {
    captureBranchDiff(repoPath: string, branchName: string, baseBranch?: string): Promise<string>;
    captureUncommittedDiff(wtPath: string): Promise<string>;
    removeTaskWorktree(repoPath: string, taskId: string, actualPath?: string): Promise<void>;
    deleteBranch(repoPath: string, branchName: string): Promise<void>;
    revertAndReturnToMain(repoPath: string, branchName: string, baseBranch?: string): Promise<void>;
  };
  sessionManager: {
    createSession(repoPath: string, data: Record<string, unknown>): Promise<{ id: string }>;
    archiveSession(
      repoPath: string,
      taskId: string,
      attempt: number,
      session: { id: string },
      wtPath?: string
    ): Promise<void>;
  };
  projectService: {
    getSettings(projectId: string): Promise<{
      simpleComplexityAgent: { type: string; model?: string | null };
      complexComplexityAgent: { type: string; model?: string | null };
      gitWorkingMode?: "worktree" | "branches";
      worktreeBaseBranch?: string;
    }>;
  };
  persistCounters(projectId: string, repoPath: string): Promise<void>;
  deleteAssignment(repoPath: string, taskId: string): Promise<void>;
  transition(projectId: string, t: { to: "fail"; taskId: string }): void;
  nudge(projectId: string): void;
  removeSlot(
    state: { slots: Map<string, FailureSlot>; status: { activeTasks: unknown } },
    taskId: string
  ): void;
  executeCodingPhase(
    projectId: string,
    repoPath: string,
    task: StoredTask,
    slot: FailureSlot,
    retryContext: RetryContext
  ): Promise<void>;
}

export interface FailureSlot {
  taskId: string;
  attempt: number;
  phase: "coding" | "review";
  infraRetries: number;
  worktreePath: string | null;
  branchName: string;
  /** When set (per_epic + epic task), worktree key for removeTaskWorktree (e.g. epic_<epicId>). */
  worktreeKey?: string;
  phaseResult: {
    codingDiff: string;
    codingSummary: string;
    testResults: TestResults | null;
    testOutput: string;
    validationCommand?: string | null;
    qualityGateDetail?: RetryQualityGateDetail | null;
  };
  agent: { outputLog: string[]; startedAt: string; killedDueToTimeout: boolean };
  /** Set when slot was created from dispatch (retry context from prior failure). */
  retryContext?: RetryContext;
  /** Agent config used for current active attempt; avoids stat key mismatches on completion. */
  activeAgentConfig?: AgentConfig;
}

type FailurePolicyDecision = "requeue_infra" | "requeue" | "demote" | "block" | "reopen";

type RunawayPolicyDecision = {
  shouldBlock: boolean;
  nextActionOverride?: string;
  blockReason?: string;
};

export class FailureHandlerService {
  constructor(private host: FailureHandlerHost) {}

  private nextActionForFailure(params: {
    diagnosedNoResultFailure: boolean;
    isInfraFailure: boolean;
    infraRetries: number;
    currentPriority: number;
    cumulativeAttempts: number;
  }): string {
    if (params.diagnosedNoResultFailure) {
      return "Blocked pending investigation";
    }
    if (params.isInfraFailure && params.infraRetries < MAX_INFRA_RETRIES) {
      return `Infrastructure retry ${params.infraRetries + 1}/${MAX_INFRA_RETRIES}`;
    }
    if (params.cumulativeAttempts % BACKOFF_FAILURE_THRESHOLD !== 0) {
      return "Requeued for retry";
    }
    if (params.currentPriority >= MAX_PRIORITY_BEFORE_BLOCK) {
      return `Blocked after ${params.cumulativeAttempts} failed attempts`;
    }
    return `Demoted to priority ${params.currentPriority + 1}`;
  }

  private buildFailureSignature(params: {
    failureType: FailureType;
    reason: string;
    diagnostic: FailureDiagnosticDetail | null;
    noResultReasonCode?: NoResultReasonCode;
  }): string {
    const reasonLine = this.firstActionableReasonLine(params.reason)?.toLowerCase() ?? "";
    const command = params.diagnostic?.command?.toLowerCase() ?? "";
    const firstError = params.diagnostic?.firstErrorLine?.toLowerCase() ?? "";
    const output = params.diagnostic?.outputSnippet?.toLowerCase() ?? "";
    const noResultCode = params.noResultReasonCode ?? "";
    const normalizedOutput = output.slice(0, 240);
    return [
      params.failureType,
      command,
      firstError,
      reasonLine,
      normalizedOutput,
      noResultCode,
    ].join("|");
  }

  private evaluateRunawayFailurePolicy(params: {
    failureType: FailureType;
    failureHistory: RetryFailureHistoryEntry[];
    nowIso: string;
  }): RunawayPolicyDecision {
    const cap = FAILURE_RETRY_CAPS[params.failureType];
    if (cap != null && cap > 0) {
      let consecutive = 0;
      for (let i = params.failureHistory.length - 1; i >= 0; i -= 1) {
        const entry = params.failureHistory[i];
        if (!entry || entry.failureType !== params.failureType) break;
        consecutive += 1;
      }
      if (consecutive >= cap) {
        return {
          shouldBlock: true,
          nextActionOverride: `Blocked after ${consecutive} consecutive ${params.failureType} failures`,
          blockReason: "Repeated execution failures",
        };
      }
    }

    const nowMs = Date.parse(params.nowIso);
    if (Number.isFinite(nowMs)) {
      const inWindow = params.failureHistory.filter((entry) => {
        if (!entry?.occurredAt) return false;
        const occurredMs = Date.parse(entry.occurredAt);
        if (!Number.isFinite(occurredMs)) return false;
        return nowMs - occurredMs <= RUNAWAY_WINDOW_MS;
      });
      if (inWindow.length >= RUNAWAY_MAX_ATTEMPTS_PER_WINDOW) {
        return {
          shouldBlock: true,
          nextActionOverride: `Blocked after ${inWindow.length} failed attempts in ${Math.round(RUNAWAY_WINDOW_MS / 3600000)}h`,
          blockReason: "Runaway retry circuit breaker",
        };
      }
    }

    let repeatedSignatureCount = 0;
    const newestSignature = params.failureHistory.at(-1)?.signature;
    if (newestSignature) {
      for (let i = params.failureHistory.length - 1; i >= 0; i -= 1) {
        const entry = params.failureHistory[i];
        if (!entry || entry.signature !== newestSignature) break;
        repeatedSignatureCount += 1;
      }
    }
    if (repeatedSignatureCount >= RUNAWAY_MAX_REPEAT_SIGNATURE) {
      return {
        shouldBlock: true,
        nextActionOverride: `Blocked after ${repeatedSignatureCount} repeated identical failure signatures`,
        blockReason: "Repeated identical failure",
      };
    }

    return { shouldBlock: false };
  }

  private enrichNoResultReason(reason: string, outputLog: string[]): string {
    const extracted = extractNoResultReasonFromOutput(outputLog, NO_RESULT_REASON_LIMIT);
    if (extracted) return extracted;

    const output = outputLog.join("").replace(/\r/g, "").trim();
    if (!output) return reason;

    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return reason;

    const nonJsonLines = lines
      .filter((line) => !line.startsWith("{"))
      .map((line) => line.replace(/^\s*[A-Z]:\s*/i, "").trim())
      .filter((line) => isMeaningfulNoResultFragment(line));
    if (nonJsonLines.length === 0) return reason;

    // Fallback: last non-JSON lines only (avoid dumping NDJSON into the reason)
    const tail = nonJsonLines.slice(-NO_RESULT_TAIL_LINES).join(" | ");
    if (tail) return `${reason}. ${tail}`.slice(0, NO_RESULT_REASON_LIMIT);
    return reason;
  }

  private isDiagnosedNoResultFailure(failureType: FailureType, reason: string): boolean {
    if (failureType !== "no_result") return false;

    const fatalPatterns = [
      /agent error:/i,
      /requires authentication/i,
      /run `?agent login`?/i,
      /no cursor api key available/i,
      /cursor agent(\s+cli)?\s+(was\s+)?not found/i,
      /claude cli was not found/i,
      /command not found/i,
      /could not read task file/i,
      /api key/i,
      /unauthorized/i,
      /rate limit/i,
      /timed out after \d+ minutes/i,
    ];
    return fatalPatterns.some((pattern) => pattern.test(reason));
  }

  private isOfflineConnectivityFailure(failureType: FailureType, reason: string): boolean {
    if (failureType !== "no_result") return false;
    return isLostInternetMessage(reason);
  }

  private isCursorProviderOutageFailure(
    failureType: FailureType,
    reason: string,
    options: {
      agentType: string;
      apiErrorKind: AgentApiErrorKind | null;
      offlineConnectivityFailure: boolean;
    }
  ): boolean {
    if (failureType !== "no_result") return false;
    if (options.agentType !== "cursor") return false;
    if (options.apiErrorKind || options.offlineConnectivityFailure) return false;
    return CURSOR_PROVIDER_OUTAGE_PATTERNS.some((pattern) => pattern.test(reason));
  }

  private truncateRetryContextText(value: string | undefined, limit: number): string | undefined {
    if (!value) return undefined;
    const compact = compactExecutionText(value, limit);
    return compact === "" ? undefined : compact;
  }

  private buildPersistedRetryContext(params: {
    failureType: FailureType;
    previousFailure: string;
    reviewFeedback?: string;
    previousTestOutput?: string;
    previousTestFailures?: string;
    previousDiff?: string;
    qualityGateDetail?: RetryQualityGateDetail | null;
    /** Append this attempt to rolling failure history (from slot.retryContext + new row). */
    failureHistoryAppend?: {
      attempt: number;
      failureType: FailureType;
      summary: string;
      occurredAt: string;
      signature: string;
    };
    existingFailureHistory?: RetryFailureHistoryEntry[];
  }): RetryContext {
    const context: RetryContext = {
      previousFailure:
        this.truncateRetryContextText(params.previousFailure, RETRY_CONTEXT_FAILURE_LIMIT) ??
        params.previousFailure.slice(0, RETRY_CONTEXT_FAILURE_LIMIT),
      failureType: params.failureType,
    };
    const reviewFeedback = this.truncateRetryContextText(
      params.reviewFeedback,
      RETRY_CONTEXT_REVIEW_LIMIT
    );
    if (reviewFeedback) {
      context.reviewFeedback = reviewFeedback;
    }
    const previousTestOutput = this.truncateRetryContextText(
      params.previousTestOutput,
      RETRY_CONTEXT_TEST_OUTPUT_LIMIT
    );
    if (previousTestOutput) {
      context.previousTestOutput = previousTestOutput;
    }
    const previousTestFailures = this.truncateRetryContextText(
      params.previousTestFailures,
      RETRY_CONTEXT_TEST_FAILURES_LIMIT
    );
    if (previousTestFailures) {
      context.previousTestFailures = previousTestFailures;
    }
    const previousDiff = this.truncateRetryContextText(
      params.previousDiff,
      RETRY_CONTEXT_DIFF_LIMIT
    );
    if (previousDiff) {
      context.previousDiff = previousDiff;
    }
    if (params.qualityGateDetail) {
      context.qualityGateDetail = {
        ...params.qualityGateDetail,
      };
    }
    if (params.failureHistoryAppend) {
      const prev = params.existingFailureHistory ?? [];
      const summary = compactExecutionText(
        params.failureHistoryAppend.summary,
        FAILURE_HISTORY_SUMMARY_LIMIT
      );
      const nextEntry: RetryFailureHistoryEntry = {
        attempt: params.failureHistoryAppend.attempt,
        failureType: params.failureHistoryAppend.failureType,
        summary:
          summary || params.failureHistoryAppend.summary.slice(0, FAILURE_HISTORY_SUMMARY_LIMIT),
        occurredAt: params.failureHistoryAppend.occurredAt,
        signature: params.failureHistoryAppend.signature,
      };
      context.failureHistory = [...prev, nextEntry].slice(-FAILURE_HISTORY_MAX_ENTRIES);
    }
    return context;
  }

  private isDependencySetupPreflightFailure(reason: string): boolean {
    return (
      reason.includes(`[${ErrorCodes.REPO_DEPENDENCIES_INVALID}]`) ||
      reason.includes(`[${ErrorCodes.DEPENDENCY_SETUP_FAILED}]`)
    );
  }

  private remediationActionForFailure(
    failureType: FailureType,
    isDependencySetupPreflightFailure: boolean
  ): string | null {
    if (failureType === "environment_setup") {
      return getRemediationForFailureType("environment_setup");
    }
    if (failureType === "repo_preflight") {
      return getRemediationForFailureType("repo_preflight", isDependencySetupPreflightFailure);
    }
    return null;
  }

  private toFailureOutputSnippet(text: string | null | undefined): string | null {
    const trimmed = text?.trim();
    if (!trimmed) return null;
    return compactExecutionText(trimmed, FAILURE_DIAGNOSTIC_OUTPUT_LIMIT);
  }

  private firstFailedTestError(testResults?: TestResults | null): string | null {
    const failedDetail = testResults?.details.find(
      (detail) => detail.status === "failed" && detail.error?.trim()
    );
    return failedDetail?.error?.trim()
      ? compactExecutionText(failedDetail.error.trim(), FAILURE_DIAGNOSTIC_LINE_LIMIT)
      : null;
  }

  private firstActionableFailureOutputLine(text: string | null | undefined): string | null {
    if (!text) return null;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^(?:FAIL|✗|✕)\b/i.test(trimmed)) continue;
      if (/^●\s+/.test(trimmed)) continue;
      if (FAILURE_DIAGNOSTIC_NOISE_PATTERNS.some((pattern) => pattern.test(trimmed))) continue;
      return compactExecutionText(trimmed, FAILURE_DIAGNOSTIC_LINE_LIMIT);
    }
    return null;
  }

  private extractCommandFromFailureReason(reason: string): string | null {
    const commandPatterns = [
      /^Command failed:\s*(.+)$/im,
      /^npm error command sh -c\s+(.+)$/im,
      /^Quality gate failed \(([^)]+)\)/i,
    ];
    for (const pattern of commandPatterns) {
      const command = reason.match(pattern)?.[1]?.trim();
      if (command) return command;
    }
    return null;
  }

  private firstActionableReasonLine(reason: string): string | null {
    const trimmed = reason.trim();
    if (!trimmed) return null;
    if (FAILURE_DIAGNOSTIC_REASON_PATTERNS.some((pattern) => pattern.test(trimmed))) return null;
    return compactExecutionText(trimmed, FAILURE_DIAGNOSTIC_LINE_LIMIT);
  }

  private buildFailureDiagnosticDetail(params: {
    failureType: FailureType;
    reason: string;
    slot: FailureSlot;
    testResults?: TestResults | null;
  }): FailureDiagnosticDetail | null {
    const structuredQualityGateDetail = params.slot.phaseResult.qualityGateDetail;
    if (
      (params.failureType === "merge_quality_gate" || params.failureType === "environment_setup") &&
      structuredQualityGateDetail
    ) {
      return {
        command:
          structuredQualityGateDetail.command?.trim() ||
          params.slot.phaseResult.validationCommand?.trim() ||
          this.extractCommandFromFailureReason(params.reason),
        reason:
          structuredQualityGateDetail.reason?.trim() ||
          (params.reason.trim() ? params.reason.trim().slice(0, 500) : null),
        outputSnippet:
          structuredQualityGateDetail.outputSnippet?.trim() ||
          this.toFailureOutputSnippet(params.slot.phaseResult.testOutput),
        worktreePath:
          structuredQualityGateDetail.worktreePath?.trim() ||
          params.slot.worktreePath?.trim() ||
          null,
        firstErrorLine:
          structuredQualityGateDetail.firstErrorLine?.trim() ||
          this.firstActionableFailureOutputLine(params.slot.phaseResult.testOutput) ||
          this.firstActionableReasonLine(params.reason),
      };
    }

    const validationOutput =
      params.failureType === "test_failure" ? params.slot.phaseResult.testOutput : "";
    const command =
      (params.failureType === "test_failure"
        ? params.slot.phaseResult.validationCommand?.trim() || null
        : null) ?? this.extractCommandFromFailureReason(params.reason);
    const firstErrorLine =
      (params.failureType === "test_failure"
        ? (this.firstFailedTestError(params.testResults ?? params.slot.phaseResult.testResults) ??
          this.firstActionableFailureOutputLine(validationOutput))
        : null) ?? this.firstActionableReasonLine(params.reason);
    const outputSnippet = this.toFailureOutputSnippet(validationOutput);
    const worktreePath = params.slot.worktreePath?.trim() || null;
    if (!command && !firstErrorLine && !outputSnippet) return null;
    return {
      command: command ?? null,
      reason: params.reason.trim() ? params.reason.slice(0, 500) : null,
      outputSnippet,
      worktreePath,
      firstErrorLine: firstErrorLine ?? null,
    };
  }

  private buildRetryTestOutput(params: {
    testResults?: TestResults | null;
    testOutput?: string;
    validationCommand?: string | null;
  }): string | undefined {
    const command = params.validationCommand?.trim() || null;
    const firstError =
      this.firstFailedTestError(params.testResults) ??
      this.firstActionableFailureOutputLine(params.testOutput ?? "");
    const outputSnippet = this.toFailureOutputSnippet(params.testOutput);
    const resultSummary =
      params.testResults != null
        ? `Result: ${params.testResults.failed} failed, ${params.testResults.passed} passed, ${params.testResults.skipped} skipped, ${params.testResults.total} total`
        : null;

    const lines: string[] = [];
    if (resultSummary) lines.push(resultSummary);
    if (command) lines.push(`Failed command: ${command}`);
    if (firstError) lines.push(`First failure: ${firstError}`);
    if (outputSnippet) {
      lines.push("Output snippet:");
      lines.push(outputSnippet);
    }
    if (lines.length === 0) return undefined;
    return lines.join("\n");
  }

  private failureDiagnosticFields(
    detail: FailureDiagnosticDetail | null
  ): Record<string, FailureDiagnosticDetail | string | null> {
    if (!detail) return {};
    return {
      failedGateCommand: detail.command,
      failedGateReason: detail.reason,
      failedGateOutputSnippet: detail.outputSnippet,
      worktreePath: detail.worktreePath,
      firstErrorLine: detail.firstErrorLine,
      qualityGateDetail: detail,
    };
  }

  private broadcastTaskRequeuedWs(
    projectId: string,
    taskId: string,
    args: {
      cumulativeAttempts: number;
      phase: string;
      failureType: FailureType;
      summary: string;
      nextAction: string;
      failureDiagnosticDetail: FailureDiagnosticDetail | null;
      requeueCountForFailureType: number;
      repeatedFailureSignatureCount: number;
    }
  ): void {
    const d = args.failureDiagnosticDetail;
    broadcastToProject(projectId, {
      type: "task.requeued",
      taskId,
      cumulativeAttempts: args.cumulativeAttempts,
      phase: args.phase,
      failureType: args.failureType,
      summary: args.summary,
      nextAction: args.nextAction,
      requeueCountForFailureType: args.requeueCountForFailureType,
      repeatedFailureSignatureCount: args.repeatedFailureSignatureCount,
      qualityGateDetail: d,
      failedGateCommand: d?.command ?? null,
      failedGateReason: d?.reason ?? null,
      failedGateOutputSnippet: d?.outputSnippet ?? null,
      worktreePath: d?.worktreePath ?? null,
    } as unknown as ServerEvent);
  }

  async handleTaskFailure(
    projectId: string,
    repoPath: string,
    task: StoredTask,
    branchName: string,
    reason: string,
    testResults?: TestResults | null,
    failureType: FailureType = "coding_failure",
    reviewFeedback?: string,
    options?: {
      reviewScope?: string;
      noResultReasonCode?: NoResultReasonCode;
    }
  ): Promise<void> {
    const state = this.host.getState(projectId);
    const slot = state.slots.get(task.id);
    if (!slot) {
      log.warn("handleTaskFailure: no slot found for task", { taskId: task.id });
      return;
    }
    const cumulativeAttempts = slot.attempt;
    const wtPath = slot.worktreePath;
    const isInfraFailure = INFRA_FAILURE_TYPES.includes(failureType);
    const effectiveReason =
      failureType === "no_result"
        ? this.enrichNoResultReason(reason, slot.agent.outputLog)
        : reason;
    const isDependencySetupPreflightFailure =
      failureType === "repo_preflight" && this.isDependencySetupPreflightFailure(effectiveReason);
    const remediationAction = this.remediationActionForFailure(
      failureType,
      isDependencySetupPreflightFailure
    );
    const diagnosedNoResultFailure = this.isDiagnosedNoResultFailure(failureType, effectiveReason);
    const currentPriority = task.priority ?? 2;
    let nextAction = this.nextActionForFailure({
      diagnosedNoResultFailure,
      isInfraFailure,
      infraRetries: slot.infraRetries,
      currentPriority,
      cumulativeAttempts,
    });
    if (remediationAction) {
      nextAction = remediationAction;
    }
    const failureSummary = compactExecutionText(
      `${slot.phase === "review" ? "Review" : "Coding"} failed: ${effectiveReason}`,
      500
    );
    const failureDiagnosticDetail = this.buildFailureDiagnosticDetail({
      failureType,
      reason: effectiveReason,
      slot,
      testResults,
    });
    const startedAtMs = Date.parse(slot.agent.startedAt ?? "");
    const attemptDurationMs = Number.isFinite(startedAtMs)
      ? Math.max(0, Date.now() - startedAtMs)
      : null;

    log.error(`Task ${task.id} failed [${failureType}] (attempt ${cumulativeAttempts})`, {
      reason: effectiveReason,
    });

    const apiErrorKind = classifyAgentApiError(
      new Error(effectiveReason)
    ) as AgentApiErrorKind | null;
    const offlineConnectivityFailure = this.isOfflineConnectivityFailure(
      failureType,
      effectiveReason
    );
    const failSettings = await this.host.projectService.getSettings(projectId);
    const agentConfig = slot.activeAgentConfig ?? failSettings.simpleComplexityAgent;
    const agentProvider = getProviderForAgentType(
      agentConfig.type as import("@opensprint/shared").AgentType
    );
    const cursorProviderOutageFailure = this.isCursorProviderOutageFailure(
      failureType,
      effectiveReason,
      {
        agentType: agentConfig.type,
        apiErrorKind,
        offlineConnectivityFailure,
      }
    );
    let providerOutageBackoff: {
      attempts: number;
      durationMs: number;
      until: string;
    } | null = null;
    if (cursorProviderOutageFailure && agentProvider === "CURSOR_API_KEY") {
      providerOutageBackoff = markProviderOutageBackoff(projectId, agentProvider, effectiveReason);
      nextAction = `Pause new Cursor launches until ${providerOutageBackoff.until}`;
    } else if (
      !providerOutageBackoff &&
      agentProvider &&
      failureType === "no_result" &&
      !offlineConnectivityFailure &&
      GENERIC_PROVIDER_OUTAGE_PATTERNS.some((p) => p.test(effectiveReason))
    ) {
      providerOutageBackoff = markProviderOutageBackoff(projectId, agentProvider, effectiveReason);
      nextAction = `Pause dispatching (rate limit / quota) until ${providerOutageBackoff.until}`;
    }
    let requeueCountForFailureType = 0;
    let repeatedFailureSignatureCount = 0;
    const commonFailureContext = {
      attemptDurationMs,
      noResultReasonCode: options?.noResultReasonCode ?? null,
      apiErrorKind: apiErrorKind ?? null,
      offlineConnectivityFailure,
      providerOutageUntil: providerOutageBackoff?.until ?? null,
      providerOutageAttempts: providerOutageBackoff?.attempts ?? null,
      provider: agentProvider ?? null,
    };
    // Surface failures in the notification system only when not a review-phase failure, or when
    // we will block (review notifications are created in blockTask when retries exceed limit).
    if (slot.phase !== "review") {
      if (apiErrorKind) {
        try {
          const notification = await notificationService.createApiBlocked({
            projectId,
            source: "execute",
            sourceId: task.id,
            message: effectiveReason.slice(0, 500),
            errorCode: apiErrorKind,
          });
          broadcastToProject(projectId, {
            type: "notification.added",
            notification: {
              id: notification.id,
              projectId: notification.projectId,
              source: notification.source,
              sourceId: notification.sourceId,
              questions: notification.questions.map((q) => ({
                id: q.id,
                text: q.text,
                createdAt: q.createdAt,
              })),
              status: "open",
              createdAt: notification.createdAt,
              resolvedAt: null,
              kind: "api_blocked",
              errorCode: notification.errorCode,
            },
          });
        } catch (notifErr) {
          log.warn("Failed to create API-blocked notification", { err: notifErr });
        }
      } else {
        try {
          const notification = await notificationService.createAgentFailed({
            projectId,
            source: "execute",
            sourceId: task.id,
            message: effectiveReason.slice(0, 2000),
          });
          broadcastToProject(projectId, {
            type: "notification.added",
            notification: {
              id: notification.id,
              projectId: notification.projectId,
              source: notification.source,
              sourceId: notification.sourceId,
              questions: notification.questions.map((q) => ({
                id: q.id,
                text: q.text,
                createdAt: q.createdAt,
              })),
              status: "open",
              createdAt: notification.createdAt,
              resolvedAt: null,
              kind: "agent_failed",
            },
          });
        } catch (notifErr) {
          log.warn("Failed to create agent-failed notification", { err: notifErr });
        }
      }
    }

    // Log all failures (including review rejections) to event log for Execution Diagnostics
    eventLogService
      .append(repoPath, {
        timestamp: new Date().toISOString(),
        projectId,
        taskId: task.id,
        event: "task.failed",
        data: {
          attempt: cumulativeAttempts,
          phase: slot.phase,
          failureType,
          model: agentConfig.model ?? null,
          reason: effectiveReason.slice(0, 500),
          summary: failureSummary,
          nextAction,
          policyDecision: null,
          ...commonFailureContext,
          ...this.failureDiagnosticFields(failureDiagnosticDetail),
        },
      })
      .catch(() => {});

    const gitWorkingMode = failSettings.gitWorkingMode ?? "worktree";
    const agentRole = slot.phase === "review" ? "reviewer" : "coder";
    const reviewScope = agentRole === "reviewer" ? options?.reviewScope : undefined;
    agentIdentityService
      .recordAttempt(repoPath, {
        taskId: task.id,
        agentId: buildAgentAttemptId(agentConfig, agentRole, {
          reviewScope,
        }),
        role: agentRole,
        model: agentConfig.model ?? "unknown",
        attempt: cumulativeAttempts,
        startedAt: slot.agent.startedAt,
        completedAt: new Date().toISOString(),
        outcome: failureType as AttemptOutcome,
        durationMs: Date.now() - new Date(slot.agent.startedAt || Date.now()).getTime(),
      })
      .catch((err) => log.warn("Failed to record attempt", { err }));

    const baseBranch = await resolveBaseBranch(repoPath, failSettings.worktreeBaseBranch);
    let previousDiff = "";
    let gitDiff = "";
    try {
      const branchDiff = await this.host.branchManager.captureBranchDiff(
        repoPath,
        branchName,
        baseBranch
      );
      previousDiff = branchDiff;
      let uncommittedDiff = "";
      if (wtPath) {
        uncommittedDiff = await this.host.branchManager.captureUncommittedDiff(wtPath);
      }
      gitDiff = [branchDiff, uncommittedDiff]
        .filter(Boolean)
        .join("\n\n--- Uncommitted changes ---\n\n");
    } catch {
      // Branch may not exist
    }

    const includePreviousTestContext =
      failureType === "test_failure" || failureType === "merge_quality_gate";
    const previousTestFailures = includePreviousTestContext
      ? buildTestFailureRetrySummary(
          slot.phaseResult.testResults,
          slot.phaseResult.testOutput || undefined
        )
      : undefined;
    const previousTestOutput = includePreviousTestContext
      ? this.buildRetryTestOutput({
          testResults: slot.phaseResult.testResults,
          testOutput: slot.phaseResult.testOutput || undefined,
          validationCommand: slot.phaseResult.validationCommand,
        })
      : undefined;
    const failureOccurredAt = new Date().toISOString();
    const failureSignature = this.buildFailureSignature({
      failureType,
      reason: effectiveReason,
      diagnostic: failureDiagnosticDetail,
      noResultReasonCode: options?.noResultReasonCode,
    });
    const persistedRetryContext = this.buildPersistedRetryContext({
      failureType,
      previousFailure: effectiveReason,
      reviewFeedback,
      previousDiff,
      previousTestOutput,
      previousTestFailures,
      qualityGateDetail: failureDiagnosticDetail ?? slot.phaseResult.qualityGateDetail ?? null,
      failureHistoryAppend: {
        attempt: cumulativeAttempts,
        failureType,
        summary: effectiveReason,
        occurredAt: failureOccurredAt,
        signature: failureSignature,
      },
      existingFailureHistory: slot.retryContext?.failureHistory,
    });
    const retryFailureHistory = persistedRetryContext.failureHistory ?? [];
    requeueCountForFailureType = retryFailureHistory.filter(
      (entry) => entry.failureType === failureType
    ).length;
    repeatedFailureSignatureCount = 0;
    for (let i = retryFailureHistory.length - 1; i >= 0; i -= 1) {
      const entry = retryFailureHistory[i];
      if (!entry || entry.signature !== failureSignature) break;
      repeatedFailureSignatureCount += 1;
    }

    const preserveBranch = failureType === "test_failure" || failureType === "review_rejection";

    if (failureType !== "review_rejection") {
      const session = await this.host.sessionManager.createSession(repoPath, {
        taskId: task.id,
        attempt: cumulativeAttempts,
        agentType: agentConfig.type,
        agentModel: agentConfig.model || "",
        gitBranch: branchName,
        status: "failed",
        outputLog: slot.agent.outputLog.join(""),
        failureReason: effectiveReason,
        testResults: testResults ?? undefined,
        gitDiff: gitDiff || undefined,
        startedAt: slot.agent.startedAt,
      });
      await this.host.sessionManager.archiveSession(
        repoPath,
        task.id,
        cumulativeAttempts,
        session,
        wtPath ?? undefined
      );
    }

    const inactivityMinutes = Math.round(AGENT_INACTIVITY_TIMEOUT_MS / (60 * 1000));
    const commentText =
      failureType === "timeout"
        ? `Attempt ${cumulativeAttempts} failed [timeout]: Agent stopped responding (${inactivityMinutes} min inactivity); task requeued.`
        : remediationAction
          ? `Attempt ${cumulativeAttempts} failed [${failureType}]: ${effectiveReason.slice(0, 500)} Remediation: ${remediationAction}`
          : failureType === "review_rejection" && reviewFeedback
            ? `Review rejected (attempt ${cumulativeAttempts}):\n\n${reviewFeedback.slice(0, 2000)}`
            : `Attempt ${cumulativeAttempts} failed [${failureType}]: ${effectiveReason.slice(0, 500)}`;
    await this.host.taskStore
      .comment(projectId, task.id, commentText)
      .catch((err) => log.warn("Failed to add failure comment", { err }));

    if (
      failureType === "no_result" &&
      (apiErrorKind || offlineConnectivityFailure || providerOutageBackoff)
    ) {
      const shouldNudgeAfterReopen = Boolean(apiErrorKind) && !offlineConnectivityFailure;
      const retrySummary = buildTaskLastExecutionSummary({
        attempt: cumulativeAttempts,
        outcome: "requeued",
        phase: slot.phase,
        failureType,
        summary: providerOutageBackoff
          ? `${failureSummary}. Provider outage detected; pausing new Cursor launches until ${providerOutageBackoff.until}.`
          : offlineConnectivityFailure
            ? `${failureSummary}. Waiting for internet connectivity to recover.`
            : `${failureSummary}. Waiting for API issue to be resolved.`,
      });
      await this.revertOrRemoveWorktree(repoPath, task.id, branchName, slot, gitWorkingMode, {
        baseBranch,
        deleteBranch: true,
      });
      await this.host.deleteAssignment(repoPath, task.id);
      try {
        await this.host.taskStore.update(projectId, task.id, {
          status: "open",
          assignee: "",
          extra: {
            last_execution_summary: retrySummary,
            [NEXT_RETRY_CONTEXT_KEY]: persistedRetryContext,
          },
        });
        await this.clearMergeQueueLabels(projectId, task);
      } catch (err) {
        log.warn("Failed to reopen task after API-blocked no_result failure", { err });
      }
      eventLogService
        .append(repoPath, {
          timestamp: new Date().toISOString(),
          projectId,
          taskId: task.id,
          event: "task.requeued",
          data: {
            attempt: cumulativeAttempts,
            phase: slot.phase,
            failureType,
            model: agentConfig.model ?? null,
            summary: retrySummary.summary,
            nextAction,
            policyDecision: "reopen" as FailurePolicyDecision,
            ...commonFailureContext,
          },
        })
        .catch(() => {});
      this.host.transition(projectId, { to: "fail", taskId: task.id });
      await this.host.persistCounters(projectId, repoPath);
      broadcastToProject(projectId, {
        type: "agent.completed",
        taskId: task.id,
        status: "failed",
        testResults: null,
        reason: effectiveReason.slice(0, 500),
      });
      if (shouldNudgeAfterReopen) {
        this.host.nudge(projectId);
      }
      return;
    }

    if (diagnosedNoResultFailure) {
      log.warn("Diagnosed no_result startup/config failure; blocking without blind retries", {
        taskId: task.id,
      });
      await this.host.taskStore.setCumulativeAttempts(projectId, task.id, cumulativeAttempts, {
        currentLabels: (task.labels ?? []) as string[],
      });
      await this.revertOrRemoveWorktree(repoPath, task.id, branchName, slot, gitWorkingMode, {
        baseBranch,
        deleteBranch: true,
      });
      await this.host.deleteAssignment(repoPath, task.id);
      await this.blockTask(
        projectId,
        repoPath,
        task,
        cumulativeAttempts,
        effectiveReason,
        failureType,
        slot.phase,
        agentConfig.model ?? null,
        slot.phase === "review" ? { effectiveReason, apiErrorKind } : undefined,
        persistedRetryContext,
        undefined,
        { diagnostics: commonFailureContext }
      );
      return;
    }

    if (failureType === "repo_preflight" || failureType === "environment_setup") {
      log.warn("Deterministic environment/setup failure; blocking task until remediated", {
        taskId: task.id,
        failureType,
      });
      await this.host.taskStore.setCumulativeAttempts(projectId, task.id, cumulativeAttempts, {
        currentLabels: (task.labels ?? []) as string[],
      });
      await this.revertOrRemoveWorktree(repoPath, task.id, branchName, slot, gitWorkingMode, {
        baseBranch,
        deleteBranch: true,
      });
      await this.host.deleteAssignment(repoPath, task.id);
      await this.blockTask(
        projectId,
        repoPath,
        task,
        cumulativeAttempts,
        effectiveReason,
        failureType,
        slot.phase,
        agentConfig.model ?? null,
        slot.phase === "review" ? { effectiveReason, apiErrorKind } : undefined,
        persistedRetryContext,
        failureDiagnosticDetail,
        remediationAction
          ? { nextAction: remediationAction, diagnostics: commonFailureContext }
          : { diagnostics: commonFailureContext }
      );
      return;
    }

    const runawayPolicy = this.evaluateRunawayFailurePolicy({
      failureType,
      failureHistory: persistedRetryContext.failureHistory ?? [],
      nowIso: failureOccurredAt,
    });
    if (runawayPolicy.shouldBlock) {
      await this.host.taskStore.setCumulativeAttempts(projectId, task.id, cumulativeAttempts, {
        currentLabels: (task.labels ?? []) as string[],
      });
      await this.revertOrRemoveWorktree(repoPath, task.id, branchName, slot, gitWorkingMode, {
        baseBranch,
        deleteBranch: true,
      });
      await this.host.deleteAssignment(repoPath, task.id);
      await this.blockTask(
        projectId,
        repoPath,
        task,
        cumulativeAttempts,
        effectiveReason,
        failureType,
        slot.phase,
        agentConfig.model ?? null,
        slot.phase === "review" ? { effectiveReason, apiErrorKind } : undefined,
        persistedRetryContext,
        failureDiagnosticDetail,
        {
          blockReason: runawayPolicy.blockReason,
          nextAction: runawayPolicy.nextActionOverride ?? "Blocked pending investigation",
          diagnostics: commonFailureContext,
        }
      );
      eventLogService
        .append(repoPath, {
          timestamp: new Date().toISOString(),
          projectId,
          taskId: task.id,
          event: "task.runaway_detected",
          data: {
            attempt: cumulativeAttempts,
            phase: slot.phase,
            failureType,
            reason: runawayPolicy.nextActionOverride ?? "runaway_retry_pattern",
            signature: failureSignature,
          },
        })
        .catch(() => {});
      return;
    }

    if (isInfraFailure && slot.infraRetries < MAX_INFRA_RETRIES) {
      const retrySummary = buildTaskLastExecutionSummary({
        attempt: cumulativeAttempts,
        outcome: "requeued",
        phase: slot.phase,
        failureType,
        summary: `${failureSummary}. ${nextAction}`,
      });
      await this.host.taskStore.update(projectId, task.id, {
        extra: {
          last_execution_summary: retrySummary,
          [NEXT_RETRY_CONTEXT_KEY]: persistedRetryContext,
          ...this.failureDiagnosticFields(failureDiagnosticDetail),
        },
      });
      eventLogService
        .append(repoPath, {
          timestamp: new Date().toISOString(),
          projectId,
          taskId: task.id,
          event: "task.requeued",
          data: {
            attempt: cumulativeAttempts,
            phase: slot.phase,
            failureType,
            model: agentConfig.model ?? null,
            summary: retrySummary.summary,
            nextAction,
            policyDecision: "requeue_infra" as FailurePolicyDecision,
            ...commonFailureContext,
            requeueCountForFailureType,
            repeatedFailureSignatureCount,
            ...this.failureDiagnosticFields(failureDiagnosticDetail),
          },
        })
        .catch(() => {});
      this.broadcastTaskRequeuedWs(projectId, task.id, {
        cumulativeAttempts,
        phase: slot.phase,
        failureType,
        summary: retrySummary.summary,
        nextAction,
        failureDiagnosticDetail,
        requeueCountForFailureType,
        repeatedFailureSignatureCount,
      });
      slot.infraRetries += 1;
      slot.attempt = cumulativeAttempts + 1;
      log.info(`Infrastructure retry ${slot.infraRetries}/${MAX_INFRA_RETRIES} for ${task.id}`, {
        failureType,
      });

      if (!preserveBranch) {
        await this.revertOrRemoveWorktree(repoPath, task.id, branchName, slot, gitWorkingMode, {
          baseBranch,
          deleteBranch: true,
        });
      }

      await this.host.persistCounters(projectId, repoPath);
      await this.host.executeCodingPhase(projectId, repoPath, task, slot, {
        previousFailure: effectiveReason,
        reviewFeedback,
        useExistingBranch: preserveBranch,
        previousDiff,
        previousTestOutput,
        previousTestFailures,
        qualityGateDetail:
          failureDiagnosticDetail ?? slot.phaseResult.qualityGateDetail ?? undefined,
        failureType,
        failureHistory: persistedRetryContext.failureHistory,
      });
      return;
    }

    if (!isInfraFailure) {
      slot.infraRetries = 0;
    }

    await this.host.taskStore.setCumulativeAttempts(projectId, task.id, cumulativeAttempts, {
      currentLabels: (task.labels ?? []) as string[],
    });

    const isDemotionPoint = cumulativeAttempts % BACKOFF_FAILURE_THRESHOLD === 0;

    if (!isDemotionPoint) {
      const retrySummary = buildTaskLastExecutionSummary({
        attempt: cumulativeAttempts,
        outcome: "requeued",
        phase: slot.phase,
        failureType,
        summary: `${failureSummary}. ${nextAction}`,
      });
      await this.host.taskStore.update(projectId, task.id, {
        extra: {
          last_execution_summary: retrySummary,
          [NEXT_RETRY_CONTEXT_KEY]: persistedRetryContext,
          ...this.failureDiagnosticFields(failureDiagnosticDetail),
        },
      });
      eventLogService
        .append(repoPath, {
          timestamp: new Date().toISOString(),
          projectId,
          taskId: task.id,
          event: "task.requeued",
          data: {
            attempt: cumulativeAttempts,
            phase: slot.phase,
            failureType,
            model: agentConfig.model ?? null,
            summary: retrySummary.summary,
            nextAction,
            policyDecision: "requeue" as FailurePolicyDecision,
            ...commonFailureContext,
            requeueCountForFailureType,
            repeatedFailureSignatureCount,
            ...this.failureDiagnosticFields(failureDiagnosticDetail),
          },
        })
        .catch(() => {});
      this.broadcastTaskRequeuedWs(projectId, task.id, {
        cumulativeAttempts,
        phase: slot.phase,
        failureType,
        summary: retrySummary.summary,
        nextAction,
        failureDiagnosticDetail,
        requeueCountForFailureType,
        repeatedFailureSignatureCount,
      });
      if (!preserveBranch) {
        await this.revertOrRemoveWorktree(repoPath, task.id, branchName, slot, gitWorkingMode, {
          baseBranch,
          deleteBranch: true,
        });
      }

      slot.attempt = cumulativeAttempts + 1;
      if (!preserveBranch) {
        log.info(`Retrying ${task.id} (attempt ${slot.attempt}) with clean branch state`);
      } else {
        log.info(
          `Retrying ${task.id} (attempt ${slot.attempt}) preserving branch for targeted fix`,
          {
            failureType,
          }
        );
      }

      await this.host.persistCounters(projectId, repoPath);
      await this.host.executeCodingPhase(projectId, repoPath, task, slot, {
        previousFailure: effectiveReason,
        reviewFeedback,
        useExistingBranch: preserveBranch,
        previousDiff,
        previousTestOutput,
        previousTestFailures,
        qualityGateDetail:
          failureDiagnosticDetail ?? slot.phaseResult.qualityGateDetail ?? undefined,
        failureType,
        failureHistory: persistedRetryContext.failureHistory,
      });
    } else {
      await this.revertOrRemoveWorktree(repoPath, task.id, branchName, slot, gitWorkingMode, {
        deleteBranch: true,
        baseBranch,
      });
      await this.host.deleteAssignment(repoPath, task.id);

      if (currentPriority >= MAX_PRIORITY_BEFORE_BLOCK) {
        await this.blockTask(
          projectId,
          repoPath,
          task,
          cumulativeAttempts,
          effectiveReason,
          failureType,
          slot.phase,
          agentConfig.model ?? null,
          slot.phase === "review" ? { effectiveReason, apiErrorKind } : undefined,
          persistedRetryContext,
          failureDiagnosticDetail,
          { diagnostics: commonFailureContext }
        );
      } else {
        const newPriority = currentPriority + 1;
        const currentComplexity =
          typeof task.complexity === "number" &&
          task.complexity >= TASK_COMPLEXITY_MIN &&
          task.complexity <= TASK_COMPLEXITY_MAX
            ? task.complexity
            : TASK_COMPLEXITY_MIN;
        const newComplexity = Math.min(TASK_COMPLEXITY_MAX, currentComplexity + 2);
        log.info(
          `Demoting ${task.id} priority ${currentPriority} → ${newPriority} after ${cumulativeAttempts} failures`
        );
        const demoteSummary = buildTaskLastExecutionSummary({
          attempt: cumulativeAttempts,
          outcome: "demoted",
          phase: slot.phase,
          failureType,
          summary: `${failureSummary}. ${nextAction}`,
        });

        try {
          await this.host.taskStore.update(projectId, task.id, {
            status: "open",
            assignee: "",
            priority: newPriority,
            complexity: newComplexity,
            extra: {
              last_execution_summary: demoteSummary,
              [NEXT_RETRY_CONTEXT_KEY]: persistedRetryContext,
              ...this.failureDiagnosticFields(failureDiagnosticDetail),
            },
          });
          await this.clearMergeQueueLabels(projectId, task);
        } catch {
          // Task may already be in the right state
        }
        eventLogService
          .append(repoPath, {
            timestamp: new Date().toISOString(),
            projectId,
            taskId: task.id,
            event: "task.demoted",
            data: {
              attempt: cumulativeAttempts,
              phase: slot.phase,
              failureType,
              model: agentConfig.model ?? null,
              summary: demoteSummary.summary,
              nextAction,
              policyDecision: "demote" as FailurePolicyDecision,
              ...commonFailureContext,
              ...this.failureDiagnosticFields(failureDiagnosticDetail),
            },
          })
          .catch(() => {});

        this.host.transition(projectId, { to: "fail", taskId: task.id });
        await this.host.persistCounters(projectId, repoPath);

        broadcastToProject(projectId, {
          type: "agent.completed",
          taskId: task.id,
          status: "failed",
          testResults: null,
          reason: effectiveReason.slice(0, 500),
        });

        this.host.nudge(projectId);
      }
    }
  }

  private async clearMergeQueueLabels(projectId: string, task: StoredTask): Promise<void> {
    if (!this.host.taskStore.removeLabel) return;
    const labels = ((task.labels ?? []) as string[]).filter((label) => typeof label === "string");
    const labelsToRemove = labels.filter(
      (label) =>
        label.startsWith("merge_stage:") ||
        label.startsWith("conflict_files:") ||
        label.startsWith("actual_files:")
    );
    for (const label of labelsToRemove) {
      await this.host.taskStore.removeLabel(projectId, task.id, label);
    }
  }

  /**
   * Revert and cleanup on failure. In Branches mode: revertAndReturnToMain (no worktree).
   * In Worktree mode: removeTaskWorktree (and optionally deleteBranch for demotion).
   */
  private async revertOrRemoveWorktree(
    repoPath: string,
    taskId: string,
    branchName: string,
    slot: FailureSlot,
    gitWorkingMode: "worktree" | "branches",
    options?: { deleteBranch?: boolean; baseBranch?: string }
  ): Promise<void> {
    const baseBranch = options?.baseBranch ?? "main";
    if (gitWorkingMode === "branches") {
      await this.host.branchManager.revertAndReturnToMain(repoPath, branchName, baseBranch);
      slot.worktreePath = null;
      return;
    }
    if (slot.worktreePath) {
      await this.host.branchManager.removeTaskWorktree(
        repoPath,
        slot.worktreeKey ?? taskId,
        slot.worktreePath
      );
      slot.worktreePath = null;
    }
    if (options?.deleteBranch) {
      await this.host.branchManager.deleteBranch(repoPath, branchName);
    }
  }

  async blockTask(
    projectId: string,
    repoPath: string,
    task: StoredTask,
    cumulativeAttempts: number,
    reason: string,
    failureType: FailureType,
    phase: "coding" | "review",
    model?: string | null,
    notificationContext?: { effectiveReason: string; apiErrorKind: AgentApiErrorKind | null },
    retryContext?: RetryContext,
    failureDiagnosticDetail?: FailureDiagnosticDetail | null,
    options?: {
      blockReason?: string;
      nextAction?: string;
      diagnostics?: {
        attemptDurationMs?: number | null;
        noResultReasonCode?: NoResultReasonCode | null;
        apiErrorKind?: AgentApiErrorKind | null;
        offlineConnectivityFailure?: boolean;
        providerOutageUntil?: string | null;
        providerOutageAttempts?: number | null;
        provider?: string | null;
      };
    }
  ): Promise<void> {
    const blockReason = options?.blockReason ?? "Coding Failure";
    const nextAction = options?.nextAction ?? "Blocked pending investigation";
    log.info(`Blocking ${task.id} after ${cumulativeAttempts} cumulative failures at max priority`);
    const blockSummary = buildTaskLastExecutionSummary({
      attempt: cumulativeAttempts,
      outcome: "blocked",
      phase,
      failureType,
      blockReason,
      summary: compactExecutionText(
        `${phase === "review" ? "Review" : "Coding"} blocked after ${cumulativeAttempts} failed attempts: ${reason}${nextAction === "Blocked pending investigation" ? "" : ` | ${nextAction}`}`,
        500
      ),
    });

    try {
      await this.host.taskStore.update(projectId, task.id, {
        status: "blocked",
        assignee: "",
        block_reason: blockReason,
        extra: {
          last_execution_summary: blockSummary,
          [NEXT_RETRY_CONTEXT_KEY]: retryContext ?? null,
          ...this.failureDiagnosticFields(failureDiagnosticDetail ?? null),
        },
      });
    } catch (err) {
      log.warn("Failed to block task", { err });
    }
    eventLogService
      .append(repoPath, {
        timestamp: new Date().toISOString(),
        projectId,
        taskId: task.id,
        event: "task.blocked",
        data: {
          attempt: cumulativeAttempts,
          phase,
          failureType,
          model: model ?? null,
          blockReason,
          summary: blockSummary.summary,
          nextAction,
          policyDecision: "block" as FailurePolicyDecision,
          attemptDurationMs: options?.diagnostics?.attemptDurationMs ?? null,
          noResultReasonCode: options?.diagnostics?.noResultReasonCode ?? null,
          apiErrorKind: options?.diagnostics?.apiErrorKind ?? null,
          offlineConnectivityFailure: options?.diagnostics?.offlineConnectivityFailure ?? false,
          providerOutageUntil: options?.diagnostics?.providerOutageUntil ?? null,
          providerOutageAttempts: options?.diagnostics?.providerOutageAttempts ?? null,
          provider: options?.diagnostics?.provider ?? null,
          ...this.failureDiagnosticFields(failureDiagnosticDetail ?? null),
        },
      })
      .catch(() => {});

    this.host.transition(projectId, { to: "fail", taskId: task.id });
    await this.host.persistCounters(projectId, repoPath);

    broadcastToProject(projectId, {
      type: "task.blocked",
      taskId: task.id,
      reason: `Blocked after ${cumulativeAttempts} failed attempts: ${reason.slice(0, 300)}`,
      cumulativeAttempts,
      qualityGateDetail: failureDiagnosticDetail ?? null,
      failedGateCommand: failureDiagnosticDetail?.command ?? null,
      failedGateReason: failureDiagnosticDetail?.reason ?? null,
      failedGateOutputSnippet: failureDiagnosticDetail?.outputSnippet ?? null,
      worktreePath: failureDiagnosticDetail?.worktreePath ?? null,
    } as ServerEvent);
    broadcastToProject(projectId, {
      type: "agent.completed",
      taskId: task.id,
      status: "failed",
      testResults: null,
      reason: reason.slice(0, 300),
    });

    // For review-phase failures that exceeded retry limit, surface notification so user is alerted
    if (phase === "review" && notificationContext) {
      const { effectiveReason: msg, apiErrorKind: kind } = notificationContext;
      try {
        if (kind) {
          const notification = await notificationService.createApiBlocked({
            projectId,
            source: "execute",
            sourceId: task.id,
            message: msg.slice(0, 500),
            errorCode: kind,
          });
          broadcastToProject(projectId, {
            type: "notification.added",
            notification: {
              id: notification.id,
              projectId: notification.projectId,
              source: notification.source,
              sourceId: notification.sourceId,
              questions: notification.questions.map((q) => ({
                id: q.id,
                text: q.text,
                createdAt: q.createdAt,
              })),
              status: "open",
              createdAt: notification.createdAt,
              resolvedAt: null,
              kind: "api_blocked",
              errorCode: notification.errorCode,
            },
          });
        } else {
          const notification = await notificationService.createAgentFailed({
            projectId,
            source: "execute",
            sourceId: task.id,
            message: msg.slice(0, 2000),
          });
          broadcastToProject(projectId, {
            type: "notification.added",
            notification: {
              id: notification.id,
              projectId: notification.projectId,
              source: notification.source,
              sourceId: notification.sourceId,
              questions: notification.questions.map((q) => ({
                id: q.id,
                text: q.text,
                createdAt: q.createdAt,
              })),
              status: "open",
              createdAt: notification.createdAt,
              resolvedAt: null,
              kind: "agent_failed",
            },
          });
        }
      } catch (notifErr) {
        log.warn("Failed to create review-failure notification after block", { err: notifErr });
      }
    }

    this.host.nudge(projectId);
  }
}
