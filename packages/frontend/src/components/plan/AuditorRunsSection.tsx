import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import { SAFE_REMARK_PLUGINS, SAFE_REHYPE_PLUGINS } from "../../lib/markdownSanitize";
import type { AuditorRun } from "@opensprint/shared";
import { useAuditorRuns } from "../../api/hooks";

/** Display format for Auditor run timestamp */
function formatAuditorRunDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** Status badge styling */
function statusBadgeClass(status: string): string {
  switch (status?.toLowerCase()) {
    case "pass":
      return "bg-theme-success-bg text-theme-success-text border-theme-success-border";
    case "issues":
      return "bg-theme-warning-bg text-theme-warning-text border-theme-warning-border";
    case "failed":
      return "bg-theme-error-bg text-theme-error-text border-theme-error-border";
    default:
      return "bg-theme-surface-muted text-theme-muted border-theme-border";
  }
}

/** Single Auditor run row — expandable to show assessment/log */
function AuditorRunRow({
  run,
  expanded,
  onToggle,
  isLast,
}: {
  run: AuditorRun;
  expanded: boolean;
  onToggle: () => void;
  isLast: boolean;
}) {
  const hasContent = Boolean(run.assessment?.trim());

  return (
    <div
      className={`rounded-lg border border-theme-border bg-theme-surface ${!isLast ? "mb-2" : ""}`}
      data-testid={`auditor-run-${run.id}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-theme-border-subtle/50 transition-colors rounded-lg"
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <span className="text-xs font-medium text-theme-text truncate">
            {formatAuditorRunDate(run.completedAt)}
          </span>
          <span
            className={`shrink-0 px-2 py-0.5 text-xs font-medium rounded border capitalize ${statusBadgeClass(run.status)}`}
          >
            {run.status}
          </span>
        </div>
        <span className="text-theme-muted text-xs shrink-0">{expanded ? "▼" : "▶"}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-theme-border-subtle mt-0">
          <div className="mt-2 text-xs prose prose-sm prose-neutral dark:prose-invert max-w-none prose-pre:bg-theme-code-bg prose-pre:text-theme-code-text prose-pre:border prose-pre:border-theme-border prose-pre:rounded-lg">
            {hasContent ? (
              <ReactMarkdown
                remarkPlugins={SAFE_REMARK_PLUGINS}
                rehypePlugins={SAFE_REHYPE_PLUGINS}
              >
                {run.assessment!}
              </ReactMarkdown>
            ) : (
              <p className="text-theme-muted italic">No assessment recorded.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export interface AuditorRunsSectionProps {
  projectId: string;
  planId: string;
}

/**
 * Lists past Auditor runs for a plan with expandable logs.
 * Reuses UX patterns from task execution (ArchivedSessionView / CollapsibleSection).
 */
export function AuditorRunsSection({ projectId, planId }: AuditorRunsSectionProps) {
  const { data: runs, isLoading, error } = useAuditorRuns(projectId, planId);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<number>>(new Set());

  const toggleRun = (id: number) => {
    setExpandedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="border-b border-theme-border">
        <div className="p-4">
          <h4 className="text-xs font-medium text-theme-muted uppercase tracking-wide mb-2">
            Auditor runs
          </h4>
          <div className="text-xs text-theme-muted">Loading…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-b border-theme-border">
        <div className="p-4">
          <h4 className="text-xs font-medium text-theme-muted uppercase tracking-wide mb-2">
            Auditor runs
          </h4>
          <div className="text-xs text-theme-error-text">Failed to load runs.</div>
        </div>
      </div>
    );
  }

  const runList = runs ?? [];

  return (
    <div className="border-b border-theme-border" data-testid="auditor-runs-section">
      <div className="p-4">
        <h4 className="text-xs font-medium text-theme-muted uppercase tracking-wide mb-3">
          Auditor runs ({runList.length})
        </h4>
        {runList.length === 0 ? (
          <p className="text-sm text-theme-muted">
            No Auditor runs yet. Runs are recorded when the final review completes for this
            plan&apos;s epic.
          </p>
        ) : (
          <div className="space-y-0">
            {runList.map((run, i) => (
              <AuditorRunRow
                key={run.id}
                run={run}
                expanded={expandedRunIds.has(run.id)}
                onToggle={() => toggleRun(run.id)}
                isLast={i === runList.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
