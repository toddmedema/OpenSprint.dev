import React from "react";
import type {
  Task,
  TaskExecutionDiagnostics,
  TaskExecutionOutcome,
  TaskExecutionPhase,
} from "@opensprint/shared";

const EXECUTION_PHASE_LABELS: Record<TaskExecutionPhase, string> = {
  coding: "Coding",
  review: "Review",
  merge: "Merge",
  orchestrator: "Orchestrator",
};

const EXECUTION_OUTCOME_LABELS: Record<TaskExecutionOutcome, string> = {
  running: "Running",
  suspended: "Suspended",
  failed: "Failed",
  rejected: "Rejected",
  requeued: "Requeued",
  demoted: "Demoted",
  blocked: "Failures",
  completed: "Completed",
};

function truncateDiagnosticsText(text: string, limit = 180): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return compact.slice(0, Math.max(0, limit - 3)).trimEnd() + "...";
}

function formatAttemptLabel(attempts: number[]): string {
  if (attempts.length === 0) return "";
  if (attempts.length === 1) return `Attempt ${attempts[0]}`;
  const first = attempts[0];
  const last = attempts[attempts.length - 1];
  return first === last ? `Attempt ${first}` : `Attempts ${first}-${last}`;
}

export function formatAttemptTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export interface TaskDetailDiagnosticsProps {
  task: Task | null;
  diagnostics: TaskExecutionDiagnostics | null;
  diagnosticsLoading: boolean;
}

/**
 * Builds up to 2 earlier-failure summary lines from past attempts.
 * Groups consecutive attempts with identical (normalized) summaries and formats them
 * as "Attempt N" or "Attempts N-M: <truncated summary>".
 */
function useEarlierFailureSummaries(diagnostics: TaskExecutionDiagnostics | null): string[] {
  return React.useMemo(() => {
    if (!diagnostics || diagnostics.attempts.length < 2) return [];

    const normalizeSummary = (summary: string) =>
      summary
        .replace(/\bAttempt \d+\b/gi, "Attempt")
        .replace(/\s+/g, " ")
        .trim();

    const olderAttempts = [...diagnostics.attempts.slice(1)]
      .filter((attempt) => attempt.finalOutcome !== "running" && attempt.finalSummary.trim() !== "")
      .sort((a, b) => a.attempt - b.attempt);
    const groups: Array<{ attempts: number[]; summary: string }> = [];

    for (const attempt of olderAttempts) {
      const summary = normalizeSummary(attempt.finalSummary);
      const previous = groups[groups.length - 1];
      if (previous && previous.summary === summary) {
        previous.attempts.push(attempt.attempt);
        continue;
      }
      groups.push({ attempts: [attempt.attempt], summary });
    }

    return groups
      .slice(0, 2)
      .map(
        (group) =>
          `${formatAttemptLabel(group.attempts)}: ${truncateDiagnosticsText(group.summary)}`
      );
  }, [diagnostics]);
}

export function TaskDetailDiagnostics({
  task,
  diagnostics,
  diagnosticsLoading,
}: TaskDetailDiagnosticsProps) {
  const earlierFailureSummaries = useEarlierFailureSummaries(diagnostics);

  return (
    <div
      className="rounded-lg border border-theme-border bg-theme-surface p-4"
      data-testid="execution-diagnostics-section"
    >
      {diagnosticsLoading && !diagnostics ? (
        <div className="text-xs text-theme-muted">Loading execution diagnostics...</div>
      ) : diagnostics &&
        (diagnostics.latestSummary ||
          diagnostics.attempts.length > 0 ||
          diagnostics.timeline.length > 0) ? (
        <div className="space-y-3">
          <div className="space-y-1 text-xs">
            {task?.blockReason && (
              <div
                className="font-medium text-theme-error-text"
                data-testid="execution-diagnostics-block-reason"
              >
                Failures: {task.blockReason}
              </div>
            )}
            {diagnostics.latestSummary && (
              <div data-testid="execution-diagnostics-latest-summary">
                <span className="text-theme-muted">Latest summary:</span>{" "}
                <span className="text-theme-text">{diagnostics.latestSummary}</span>
              </div>
            )}
            {earlierFailureSummaries.length > 0 && (
              <div data-testid="execution-diagnostics-earlier-failures">
                <span className="text-theme-muted">Earlier failures:</span>{" "}
                <span className="text-theme-text">{earlierFailureSummaries.join("; ")}</span>
              </div>
            )}
            {diagnostics.latestNextAction && (
              <div data-testid="execution-diagnostics-next-action">
                <span className="text-theme-muted">Next action:</span>{" "}
                <span className="text-theme-text">{diagnostics.latestNextAction}</span>
              </div>
            )}
            <div>
              <span className="text-theme-muted">Attempts:</span>{" "}
              <span className="text-theme-text">{diagnostics.cumulativeAttempts}</span>
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-theme-text">Attempt history</div>
            <div className="mt-2 space-y-2">
              {diagnostics.attempts.map((attempt) => (
                <div
                  key={attempt.attempt}
                  className="rounded-md border border-theme-border-subtle bg-theme-code-bg px-3 py-2 text-xs"
                  data-testid={`execution-attempt-${attempt.attempt}`}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-theme-text">
                      Attempt {attempt.attempt}
                    </span>
                    <span className="text-theme-muted">
                      {EXECUTION_PHASE_LABELS[attempt.finalPhase]} ·{" "}
                      {EXECUTION_OUTCOME_LABELS[attempt.finalOutcome]}
                    </span>
                    {(attempt.completedAt ?? attempt.startedAt) && (
                      <span className="ml-auto text-theme-muted shrink-0">
                        {formatAttemptTimestamp(attempt.completedAt ?? attempt.startedAt)}
                      </span>
                    )}
                  </div>
                  {(attempt.codingModel || attempt.reviewModel) && (
                    <div className="mt-1 text-theme-muted">
                      {attempt.codingModel && `Coder: ${attempt.codingModel}`}
                      {attempt.codingModel && attempt.reviewModel && " · "}
                      {attempt.reviewModel && `Reviewer: ${attempt.reviewModel}`}
                    </div>
                  )}
                  {attempt.mergeStage && (
                    <div className="mt-1 text-theme-muted">
                      Merge stage: {attempt.mergeStage}
                    </div>
                  )}
                  {(attempt.conflictedFiles?.length ?? 0) > 0 && (
                    <div className="mt-1 text-theme-muted">
                      Conflicts: {attempt.conflictedFiles?.join(", ")}
                    </div>
                  )}
                  <div className="mt-1 text-theme-text">{attempt.finalSummary}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-xs text-theme-muted">No execution diagnostics yet.</div>
      )}
    </div>
  );
}
