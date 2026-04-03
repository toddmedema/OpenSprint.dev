/**
 * Aggregates orchestrator_events into ranked buckets for failure diagnostics.
 */

import type { FailureMetricBucket, FailureMetricsSummary } from "@opensprint/shared";
import type { OrchestratorEvent } from "./event-log.service.js";

const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;
const MAX_BUCKETS = 80;

/** Events that carry structured failure context in `data`. */
const ROLLUP_EVENT_NAMES = new Set([
  "task.failed",
  "task.requeued",
  "task.blocked",
  "merge.failed",
  "task.dispatch_deferred",
  "agent.suspended",
  "recovery.stale_heartbeat",
  "recovery.agent_assignee_no_process_reset",
  "recovery.in_progress_without_assignee_reset",
]);

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function bucketKey(parts: {
  event: string;
  failureType: string | null;
  mergeStage: string | null;
  phase: string | null;
  signatureBucket: string | null;
  qualityGateCategory: string | null;
  validationWorkspace: string | null;
  classificationConfidence: "high" | "low" | null;
}): string {
  return `${parts.event}\0${parts.failureType ?? ""}\0${parts.mergeStage ?? ""}\0${parts.phase ?? ""}\0${parts.signatureBucket ?? ""}\0${parts.qualityGateCategory ?? ""}\0${parts.validationWorkspace ?? ""}\0${parts.classificationConfidence ?? ""}`;
}

function parseData(data: Record<string, unknown> | undefined): {
  failureType: string | null;
  mergeStage: string | null;
  phase: string | null;
  signatureBucket: string | null;
  qualityGateCategory: string | null;
  validationWorkspace: string | null;
  classificationConfidence: "high" | "low" | null;
} {
  if (!data) {
    return {
      failureType: null,
      mergeStage: null,
      phase: null,
      signatureBucket: null,
      qualityGateCategory: null,
      validationWorkspace: null,
      classificationConfidence: null,
    };
  }
  const qualityGateCategory = asString(data.qualityGateCategory);
  const validationWorkspace =
    asString(data.qualityGateValidationWorkspace) ?? asString(data.validationWorkspace);
  const classificationConfidenceRaw =
    asString(data.qualityGateClassificationConfidence) ?? asString(data.classificationConfidence);
  const classificationConfidence =
    classificationConfidenceRaw === "high" || classificationConfidenceRaw === "low"
      ? classificationConfidenceRaw
      : null;
  const detailText = [
    asString(data.failedGateReason),
    asString(data.qualityGateFirstErrorLine),
    asString(data.reason),
  ]
    .filter((value): value is string => value != null)
    .join("\n")
    .toLowerCase();
  const noResultReasonCode = asString(data.noResultReasonCode);
  const apiErrorKind = asString(data.apiErrorKind);
  const policyDecision = asString(data.policyDecision);
  const toolStatus = asString(data.toolStatus);
  let signatureBucket: string | null = null;
  if (noResultReasonCode) {
    signatureBucket = `no_result:${noResultReasonCode}`;
  } else if (apiErrorKind) {
    signatureBucket = `provider_api:${apiErrorKind}`;
  } else if (policyDecision) {
    signatureBucket = `policy:${policyDecision}`;
  } else if (toolStatus) {
    signatureBucket = `tool:${toolStatus}`;
  }
  if (!signatureBucket && qualityGateCategory === "environment_setup") {
    if (
      /\b(package\.json|package-lock\.json|lockfile|node_modules|worktree|rev-parse|not a git repository|needed a single revision)\b/i.test(
        detailText
      )
    ) {
      signatureBucket = "workspace_preflight";
    } else if (
      /\b(cannot resolve project for repo path|project id|repo path)\b/i.test(detailText)
    ) {
      signatureBucket = "project_resolution";
    } else if (classificationConfidence === "low") {
      signatureBucket = "environment_config_drift";
    } else {
      signatureBucket = "environment_setup_other";
    }
  } else if (!signatureBucket && qualityGateCategory === "quality_gate") {
    signatureBucket = "deterministic_code_regression";
  } else if (!signatureBucket && asString(data.failureType) === "merge_quality_gate") {
    signatureBucket = "quality_gate_unclassified";
  }

  return {
    failureType: asString(data.failureType),
    mergeStage: asString(data.mergeStage) ?? asString(data.stage),
    phase: asString(data.phase),
    signatureBucket,
    qualityGateCategory,
    validationWorkspace,
    classificationConfidence,
  };
}

export function rollupOrchestratorEvents(
  projectId: string,
  sinceIso: string,
  untilIso: string,
  events: OrchestratorEvent[]
): FailureMetricsSummary {
  const tallies = new Map<string, FailureMetricBucket>();

  let totalMatched = 0;
  for (const ev of events) {
    if (!ROLLUP_EVENT_NAMES.has(ev.event)) continue;
    totalMatched += 1;
    const parsed = parseData(ev.data);
    if (!parsed.signatureBucket && ev.event.startsWith("recovery.")) {
      parsed.signatureBucket = ev.event.replace(/\./g, "_");
    }
    const key = bucketKey({ event: ev.event, ...parsed });
    const existing = tallies.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      tallies.set(key, {
        event: ev.event,
        failureType: parsed.failureType,
        mergeStage: parsed.mergeStage,
        phase: parsed.phase,
        signatureBucket: parsed.signatureBucket,
        qualityGateCategory: parsed.qualityGateCategory,
        validationWorkspace: parsed.validationWorkspace,
        classificationConfidence: parsed.classificationConfidence,
        count: 1,
      });
    }
  }

  const buckets = [...tallies.values()].sort((a, b) => b.count - a.count).slice(0, MAX_BUCKETS);

  return {
    projectId,
    since: sinceIso,
    until: untilIso,
    totalEventsMatched: totalMatched,
    buckets,
  };
}

export function resolveFailureMetricsWindow(days?: number): {
  sinceIso: string;
  untilIso: string;
  daysUsed: number;
} {
  const d =
    days != null && Number.isFinite(days) && days > 0
      ? Math.min(Math.floor(days), MAX_DAYS)
      : DEFAULT_DAYS;
  const until = new Date();
  const since = new Date(until.getTime() - d * 24 * 60 * 60 * 1000);
  return {
    sinceIso: since.toISOString(),
    untilIso: until.toISOString(),
    daysUsed: d,
  };
}

/**
 * Emit a baseline failure-type distribution snapshot as an orchestrator event.
 * Called periodically (e.g. by watchdog/recovery) to track KPI trends over time.
 */
export function buildFailureBaselineSnapshot(
  events: OrchestratorEvent[],
  windowMs: number = 60 * 60 * 1000
): Record<string, number> {
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const distribution: Record<string, number> = {};
  for (const ev of events) {
    if (ev.event !== "task.failed") continue;
    if (ev.timestamp < cutoff) continue;
    const ft = asString(ev.data?.failureType) ?? "unknown";
    distribution[ft] = (distribution[ft] ?? 0) + 1;
  }
  return distribution;
}

export const FAILURE_METRICS_DEFAULT_DAYS = DEFAULT_DAYS;
export const FAILURE_METRICS_MAX_DAYS = MAX_DAYS;
