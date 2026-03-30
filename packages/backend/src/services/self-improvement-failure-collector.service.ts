/**
 * Failure collector for the self-improvement audit flow.
 *
 * Queries orchestrator events and blocked tasks whose timestamps fall after
 * the last completed self-improvement run, classifies each failure, and
 * returns structured records the audit agent can use as input context.
 */

import type { OrchestratorEvent } from "./event-log.service.js";
import { eventLogService } from "./event-log.service.js";
import { taskStore } from "./task-store.service.js";
import type { StoredTask } from "./task-store.types.js";
import { getCumulativeAttemptsFromIssue } from "./task-store-helpers.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("self-improvement-failure-collector");

/**
 * High-level failure category used by the self-improvement audit.
 * - execution: coding agent failed (test, crash, timeout, no result)
 * - merge: merge conflict or merge-to-main failure
 * - quality_gate: quality-gate command failure during merge validation
 * - environment: repo preflight or environment setup failure
 */
export type AgentFailureType = "execution" | "merge" | "quality_gate" | "environment";

export interface CollectedFailure {
  taskId: string;
  failureType: AgentFailureType;
  /** The raw failure type string from the event/task (e.g. "test_failure", "merge_conflict"). */
  rawFailureType?: string;
  noResultReasonCode?: string;
  policyDecision?: string;
  apiErrorKind?: string;
  failedCommand?: string;
  errorSnippet?: string;
  attemptCount: number;
  /** How the failure was ultimately resolved: blocked, requeued, closed, or still open. */
  finalDisposition: "blocked" | "requeued" | "closed" | "open";
  timestamp: string;
}

const FAILURE_EVENTS = new Set(["task.failed", "task.blocked", "merge.failed", "task.requeued"]);

/**
 * Map raw failure-type strings (from FailureType union or event data) to
 * the coarser AgentFailureType categories.
 */
export function classifyFailureType(raw: string | undefined | null): AgentFailureType {
  if (!raw) return "execution";
  switch (raw) {
    case "merge_conflict":
      return "merge";
    case "merge_quality_gate":
    case "quality_gate":
      return "quality_gate";
    case "repo_preflight":
    case "environment_setup":
      return "environment";
    case "test_failure":
    case "review_rejection":
    case "agent_crash":
    case "timeout":
    case "no_result":
    case "coding_failure":
      return "execution";
    default:
      return "execution";
  }
}

/**
 * Resolve the final disposition for a task.
 * If the task is still in the store we use its current status;
 * otherwise fall back to the event that reported the failure.
 */
function resolveDisposition(
  eventName: string,
  task: StoredTask | undefined
): CollectedFailure["finalDisposition"] {
  if (task) {
    const s = (task.status as string) ?? "open";
    if (s === "blocked") return "blocked";
    if (s === "closed") return "closed";
    if (s === "open") return "requeued";
    return "open";
  }
  if (eventName === "task.blocked") return "blocked";
  if (eventName === "task.requeued") return "requeued";
  return "open";
}

function extractErrorSnippet(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined;
  const snippet =
    (data.failedGateOutputSnippet as string) ??
    (data.firstErrorLine as string) ??
    (data.summary as string) ??
    (data.reason as string);
  if (!snippet) return undefined;
  const trimmed = snippet.trim();
  if (trimmed.length <= 500) return trimmed;
  return `${trimmed.slice(0, 497)}...`;
}

function extractFailedCommand(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined;
  return (data.failedGateCommand as string) ?? undefined;
}

/**
 * Collect agent failures since a given timestamp for a project.
 *
 * @param projectId - project to query
 * @param sinceIso - ISO timestamp of the last self-improvement run (inclusive).
 *                   Pass undefined or empty string to collect all-time failures.
 * @returns Array of structured failure records, empty when no failures found.
 */
export async function collectFailuresSince(
  projectId: string,
  sinceIso: string | undefined
): Promise<CollectedFailure[]> {
  const since = sinceIso?.trim() || "1970-01-01T00:00:00.000Z";

  let events: OrchestratorEvent[];
  try {
    events = await eventLogService.readSinceByProjectId(projectId, since);
  } catch (err) {
    log.warn("Failed to read orchestrator events for failure collection", {
      projectId,
      since,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const failureEvents = events.filter((e) => FAILURE_EVENTS.has(e.event));
  if (failureEvents.length === 0) return [];

  const taskIds = [...new Set(failureEvents.map((e) => e.taskId).filter(Boolean))];
  const taskMap = new Map<string, StoredTask>();
  if (taskIds.length > 0) {
    try {
      const allTasks = await taskStore.listAll(projectId);
      for (const t of allTasks) {
        taskMap.set(t.id, t);
      }
    } catch (err) {
      log.warn("Failed to load tasks for failure collection", {
        projectId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const seen = new Map<string, CollectedFailure>();

  for (const evt of failureEvents) {
    const taskId = evt.taskId;
    if (!taskId) continue;

    const data = evt.data;
    const rawType = (data?.failureType as string) ?? undefined;
    const failureType = classifyFailureType(rawType);
    const task = taskMap.get(taskId);
    const attemptCount =
      (data?.attempt as number) ??
      (data?.cumulativeAttempts as number) ??
      (task ? getCumulativeAttemptsFromIssue(task) : 0);

    const failure: CollectedFailure = {
      taskId,
      failureType,
      ...(rawType && { rawFailureType: rawType }),
      ...(typeof data?.noResultReasonCode === "string" && {
        noResultReasonCode: data.noResultReasonCode,
      }),
      ...(typeof data?.policyDecision === "string" && { policyDecision: data.policyDecision }),
      ...(typeof data?.apiErrorKind === "string" && { apiErrorKind: data.apiErrorKind }),
      failedCommand: extractFailedCommand(data),
      errorSnippet: extractErrorSnippet(data),
      attemptCount,
      finalDisposition: resolveDisposition(evt.event, task),
      timestamp: evt.timestamp,
    };

    const existing = seen.get(taskId);
    if (!existing || evt.timestamp > existing.timestamp) {
      seen.set(taskId, failure);
    }
  }

  return [...seen.values()];
}

/**
 * Format collected failures into a text block suitable for inclusion
 * in the self-improvement audit agent prompt.
 */
export function formatFailuresForPrompt(failures: CollectedFailure[]): string {
  if (failures.length === 0) return "";

  const lines: string[] = [
    `## Agent Failures Since Last Self-Improvement Run (${failures.length} total)`,
    "",
  ];

  for (const f of failures) {
    lines.push(`### Task ${f.taskId}`);
    lines.push(
      `- **Failure type:** ${f.failureType}${f.rawFailureType ? ` (${f.rawFailureType})` : ""}`
    );
    if (f.noResultReasonCode) {
      lines.push(`- **No-result reason code:** ${f.noResultReasonCode}`);
    }
    if (f.policyDecision) {
      lines.push(`- **Policy decision:** ${f.policyDecision}`);
    }
    if (f.apiErrorKind) {
      lines.push(`- **API error kind:** ${f.apiErrorKind}`);
    }
    lines.push(`- **Attempts:** ${f.attemptCount}`);
    lines.push(`- **Disposition:** ${f.finalDisposition}`);
    if (f.failedCommand) {
      lines.push(`- **Failed command:** \`${f.failedCommand}\``);
    }
    if (f.errorSnippet) {
      lines.push(`- **Error snippet:**`);
      lines.push("```");
      lines.push(f.errorSnippet);
      lines.push("```");
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build supplemental system-prompt instructions for failure root-cause analysis.
 * Returns an empty string when no failures are present so the prompt
 * gracefully omits the section with no empty placeholders.
 */
export function buildFailureReviewSystemSupplement(failures: CollectedFailure[]): string {
  if (failures.length === 0) return "";

  const typeCounts = new Map<AgentFailureType, number>();
  for (const f of failures) {
    typeCounts.set(f.failureType, (typeCounts.get(f.failureType) ?? 0) + 1);
  }
  const hasEnvOrInfra = typeCounts.has("environment") || typeCounts.has("quality_gate");
  const hasCodeLogic = typeCounts.has("execution") || typeCounts.has("merge");

  const lines: string[] = [
    "",
    "## Failure Root-Cause Analysis",
    "",
    `You have been provided with ${failures.length} agent failure(s) from recent runs.`,
    "In addition to general improvements, perform a **failure root-cause analysis**:",
    "",
    "1. **Group failures by pattern/root cause.** Identify clusters of failures that share the same underlying cause (e.g. missing dependency, flaky test, incorrect merge base).",
    "2. **Classify each group as environmental/infrastructure or code/logic:**",
  ];

  if (hasEnvOrInfra) {
    lines.push(
      "   - **Environmental/infrastructure:** failures caused by environment setup, missing tools, dependency issues, CI configuration, or quality-gate command misconfiguration."
    );
  }
  if (hasCodeLogic) {
    lines.push(
      "   - **Code/logic:** failures caused by bugs, incorrect implementations, test logic errors, or merge conflicts from overlapping changes."
    );
  }
  if (!hasEnvOrInfra && !hasCodeLogic) {
    lines.push(
      "   - **Environmental/infrastructure:** failures caused by environment setup, missing tools, dependency issues, CI configuration."
    );
    lines.push(
      "   - **Code/logic:** failures caused by bugs, incorrect implementations, test logic errors, or merge conflicts."
    );
  }

  lines.push(
    "3. **Identify recurring failure patterns** that appear across multiple tasks. Prioritize patterns by frequency (how many tasks affected) and impact (blocked vs. requeued).",
    "4. **Propose root-cause fix tasks.** Each fix task MUST include:",
    "   - A clear title that states the root-cause fix (do not use special title prefixes).",
    "   - A `description` containing:",
    "     - **Root cause:** one-sentence explanation of the underlying problem.",
    "     - **Affected area:** file path(s), module(s), or subsystem(s) involved.",
    "     - **Remediation steps:** concrete, numbered steps to fix the root cause.",
    "     - **Acceptance criteria:** measurable conditions that confirm the fix works.",
    "   - `priority` — lower (0-1) for high-frequency or high-impact patterns; higher (2-4) for isolated issues.",
    "   - `complexity` — as usual, 1-10 based on implementation difficulty.",
    "",
    "Prioritize root-cause fix tasks for **high-frequency** (affecting multiple tasks) and **high-impact** (tasks blocked rather than requeued) failure patterns.",
    "Root-cause fix tasks should appear first in your output, before general improvement tasks."
  );

  return lines.join("\n");
}

/**
 * Build supplemental user-prompt instructions that direct the agent to
 * analyze the provided failures. Returns empty string when no failures exist.
 */
export function buildFailureReviewUserSupplement(failures: CollectedFailure[]): string {
  if (failures.length === 0) return "";

  const blockedCount = failures.filter((f) => f.finalDisposition === "blocked").length;
  const requeuedCount = failures.filter((f) => f.finalDisposition === "requeued").length;
  const multiAttempt = failures.filter((f) => f.attemptCount > 1).length;

  const stats: string[] = [];
  if (blockedCount > 0) stats.push(`${blockedCount} blocked`);
  if (requeuedCount > 0) stats.push(`${requeuedCount} requeued`);
  if (multiAttempt > 0) stats.push(`${multiAttempt} with multiple attempts`);
  const statsLine = stats.length > 0 ? ` (${stats.join(", ")})` : "";

  return [
    "",
    `**Failure Review:** The failures section above contains ${failures.length} failure(s)${statsLine}. ` +
      "Analyze them for root causes and include concrete root-cause fix tasks in your output. " +
      "See the system instructions for the required fix-task format.",
  ].join("\n");
}
