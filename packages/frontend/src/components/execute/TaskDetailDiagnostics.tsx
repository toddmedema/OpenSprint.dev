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

const MERGE_STAGE_LABELS: Record<string, string> = {
  rebase_before_merge: "Rebase before merge",
  merge_to_main: "Merge to main",
  push_rebase: "Push rebase",
  quality_gate: "Quality gate",
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

function firstNonEmptyLine(value: string | null | undefined): string | null {
  if (!value) return null;
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function formatMergeStageLabel(mergeStage: string): string {
  return MERGE_STAGE_LABELS[mergeStage] ?? mergeStage.replace(/_/g, " ");
}

interface DiagnosticsFailurePresentation {
  primaryMessage: string | null;
  command: string | null;
  reason: string | null;
  outputSnippet: string | null;
  worktreePath: string | null;
  remediation: string | null;
  hasStructuredDetail: boolean;
  userTitle: string | null;
  userSummary: string | null;
  validationWorkspace:
    | "baseline"
    | "merged_candidate"
    | "task_worktree"
    | "repo_root"
    | null;
  humanHeadlineId: string | null;
}

function useFailurePresentation(
  diagnostics: TaskExecutionDiagnostics | null
): DiagnosticsFailurePresentation {
  return React.useMemo(() => {
    if (!diagnostics) {
      return {
        primaryMessage: null,
        command: null,
        reason: null,
        outputSnippet: null,
        worktreePath: null,
        remediation: null,
        hasStructuredDetail: false,
        userTitle: null,
        userSummary: null,
        validationWorkspace: null,
        humanHeadlineId: null,
      };
    }

    const detail = diagnostics.latestQualityGateDetail ?? null;
    const command = detail?.command?.trim() || null;
    const reason = detail?.reason?.trim() || null;
    const outputSnippet = detail?.outputSnippet?.trim() || null;
    const worktreePath = detail?.worktreePath?.trim() || null;
    const remediation = diagnostics.latestNextAction?.trim() || null;
    const detailFirstErrorLine = detail?.firstErrorLine?.trim() || null;
    const userTitle = detail?.userTitle?.trim() || null;
    const userSummary = detail?.userSummary?.trim() || null;
    const validationWorkspace = detail?.validationWorkspace ?? null;
    const firstErrorLine =
      detailFirstErrorLine || firstNonEmptyLine(outputSnippet) || firstNonEmptyLine(reason);
    const hasStructuredPayload = Boolean(
      detail &&
        (command ||
          reason ||
          outputSnippet ||
          worktreePath ||
          detailFirstErrorLine ||
          userTitle ||
          userSummary)
    );
    const humanEnvironmentHeadline =
      detail?.category === "environment_setup" && (userTitle || userSummary)
        ? [userTitle, userSummary].filter(Boolean).join(" — ")
        : null;
    const primaryMessage = hasStructuredPayload
      ? humanEnvironmentHeadline
        ? humanEnvironmentHeadline
        : command && firstErrorLine
          ? `${command} | ${firstErrorLine}`
          : command || firstErrorLine
      : null;

    const hasStructuredDetail = Boolean(
      hasStructuredPayload && (outputSnippet || worktreePath || remediation || reason)
    );

    const humanHeadlineId =
      humanEnvironmentHeadline && primaryMessage?.trim()
        ? "execution-diagnostics-human-headline"
        : null;

    return {
      primaryMessage: primaryMessage?.trim() || null,
      command,
      reason,
      outputSnippet,
      worktreePath,
      remediation,
      hasStructuredDetail,
      userTitle,
      userSummary,
      validationWorkspace,
      humanHeadlineId,
    };
  }, [diagnostics]);
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
  const failurePresentation = useFailurePresentation(diagnostics);
  const [detailsExpanded, setDetailsExpanded] = React.useState(false);

  const mergedCandidateWorktreeDescribedBy =
    failurePresentation.validationWorkspace === "merged_candidate"
      ? [
          failurePresentation.userTitle || failurePresentation.userSummary
            ? "execution-diagnostics-detail-human-preface"
            : null,
          failurePresentation.humanHeadlineId,
        ]
          .filter((id): id is string => Boolean(id))
          .join(" ") || undefined
      : undefined;

  React.useEffect(() => {
    setDetailsExpanded(false);
  }, [diagnostics?.taskId, diagnostics?.cumulativeAttempts]);

  return (
    <div data-testid="execution-diagnostics-section">
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
            {failurePresentation.primaryMessage && (
              <div
                data-testid="execution-diagnostics-primary-message"
                id={failurePresentation.humanHeadlineId ?? undefined}
              >
                <span className="text-theme-muted">Latest failure:</span>{" "}
                <span className="text-theme-text">{failurePresentation.primaryMessage}</span>
              </div>
            )}
            {failurePresentation.hasStructuredDetail && (
              <div className="mt-2 rounded-md border border-theme-border-subtle bg-theme-code-bg p-2">
                <button
                  type="button"
                  className="rounded text-theme-muted hover:text-theme-text transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-theme-bg"
                  onClick={() => setDetailsExpanded((prev) => !prev)}
                  aria-expanded={detailsExpanded}
                  data-testid="execution-diagnostics-details-toggle"
                >
                  {detailsExpanded ? "Hide details" : "Show details"}
                </button>
                {detailsExpanded && (
                  <div className="mt-2 space-y-2" data-testid="execution-diagnostics-details">
                    {(failurePresentation.userTitle || failurePresentation.userSummary) && (
                      <p
                        className="text-xs leading-snug text-theme-text"
                        id="execution-diagnostics-detail-human-preface"
                      >
                        {[failurePresentation.userTitle, failurePresentation.userSummary]
                          .filter(Boolean)
                          .join(". ")}
                      </p>
                    )}
                    {failurePresentation.reason && (
                      <div data-testid="execution-diagnostics-details-reason">
                        <span className="text-theme-muted">Reason:</span>{" "}
                        <span className="text-theme-text">{failurePresentation.reason}</span>
                      </div>
                    )}
                    {failurePresentation.outputSnippet && (
                      <div data-testid="execution-diagnostics-details-output-snippet">
                        <div className="text-theme-muted">Output snippet:</div>
                        <pre className="mt-1 whitespace-pre-wrap break-words text-theme-text">
                          {failurePresentation.outputSnippet}
                        </pre>
                      </div>
                    )}
                    {failurePresentation.worktreePath && (
                      <div
                        data-testid="execution-diagnostics-details-worktree"
                        aria-describedby={mergedCandidateWorktreeDescribedBy}
                      >
                        <span className="text-theme-muted">
                          {failurePresentation.validationWorkspace === "merged_candidate"
                            ? "Internal validation folder (not your project path):"
                            : "Worktree:"}
                        </span>{" "}
                        <span className="text-theme-text">{failurePresentation.worktreePath}</span>
                      </div>
                    )}
                    {failurePresentation.remediation && (
                      <div data-testid="execution-diagnostics-details-remediation">
                        <span className="text-theme-muted">Remediation:</span>{" "}
                        <span className="text-theme-text">{failurePresentation.remediation}</span>
                      </div>
                    )}
                  </div>
                )}
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
                  className="card px-3 py-2 text-xs transition-colors hover:bg-theme-surface-muted"
                  data-testid={`execution-attempt-${attempt.attempt}`}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-theme-text">Attempt {attempt.attempt}</span>
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
                      Stage: {formatMergeStageLabel(attempt.mergeStage)}
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
