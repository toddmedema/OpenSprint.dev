import { useCallback, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { formatSectionKey, formatTimestamp } from "../../lib/formatting";
import { getPrdSourceColor, PRD_SOURCE_LABELS } from "../../lib/constants";
import { api, isApiError } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";
import { DiffView } from "../diff/DiffView";
import type { DiffResult } from "../diff/DiffView";
import { useModalA11y } from "../../hooks/useModalA11y";

export interface PrdHistoryEntry {
  section: string;
  version: number;
  timestamp: string;
  source: string;
  diff: string;
  /** Document version after this change; for version-diff feature (from PrdChangeLogEntry) */
  documentVersion?: number;
}

export interface PrdChangeLogProps {
  projectId: string;
  entries: PrdHistoryEntry[];
  expanded: boolean;
  onToggle: () => void;
}

export function PrdChangeLog({ projectId, entries, expanded, onToggle }: PrdChangeLogProps) {
  const [diffModalFromVersion, setDiffModalFromVersion] = useState<number | null>(null);

  const closeDiffModal = useCallback(() => {
    setDiffModalFromVersion(null);
  }, []);

  const diffModalContainerRef = useRef<HTMLDivElement>(null);
  useModalA11y({
    containerRef: diffModalContainerRef,
    onClose: closeDiffModal,
    isOpen: diffModalFromVersion != null,
  });

  const fromKey = diffModalFromVersion != null ? String(diffModalFromVersion) : "";
  const {
    data: versionDiffPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: diffLoading,
    isError: diffQueryError,
    error: diffQueryErr,
  } = useInfiniteQuery({
    queryKey: [...queryKeys.prd.versionDiff(projectId, fromKey), "paged"] as const,
    queryFn: ({ pageParam }) =>
      api.prd.getVersionDiff(projectId, fromKey, undefined, { lineOffset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.diff.pagination?.hasMore
        ? last.diff.pagination.offset + last.diff.pagination.limit
        : undefined,
    enabled: diffModalFromVersion != null,
  });

  const diffError = diffQueryError
    ? isApiError(diffQueryErr) && diffQueryErr.code === "NOT_FOUND"
      ? "Version not found."
      : diffQueryErr instanceof Error
        ? diffQueryErr.message
        : "Failed to load diff"
    : null;

  const diffResult = useMemo((): {
    diff: DiffResult;
    fromVersion: string;
    toVersion: string;
    fromContent?: string;
    toContent?: string;
  } | null => {
    if (!versionDiffPages?.pages.length) return null;
    const lines = versionDiffPages.pages.flatMap((p) => p.diff.lines);
    const summary = versionDiffPages.pages[0]?.diff.summary;
    const first = versionDiffPages.pages[0]!;
    return {
      diff: { lines, summary },
      fromVersion: first.fromVersion,
      toVersion: first.toVersion,
      fromContent: first.fromContent,
      toContent: first.toContent,
    };
  }, [versionDiffPages]);

  return (
    <div className="mt-10 pt-6 border-t border-theme-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between w-full text-left text-sm font-medium text-theme-muted hover:text-theme-text"
      >
        <span>Change history</span>
        <span className="text-theme-muted text-xs">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
          <span className="ml-1">{expanded ? "▲" : "▼"}</span>
        </span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
          {entries.length === 0 ? (
            <p className="text-sm text-theme-muted">No changes yet</p>
          ) : (
            [...entries].reverse().map((entry, i) => (
              <div
                key={`${entry.section}-${entry.version}-${i}`}
                className="text-xs bg-theme-surface-muted rounded border border-theme-border p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-theme-text">
                    {formatSectionKey(entry.section)}
                  </span>
                  <span className="text-theme-muted shrink-0">
                    {formatTimestamp(entry.timestamp)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getPrdSourceColor(entry.source)}`}
                  >
                    {PRD_SOURCE_LABELS[entry.source] ?? entry.source}
                  </span>
                  <span className="text-theme-muted">v{entry.version}</span>
                  <span className="text-theme-muted truncate">{entry.diff}</span>
                  {entry.documentVersion != null && (
                    <button
                      type="button"
                      onClick={() => {
                        setDiffModalFromVersion(entry.documentVersion!);
                      }}
                      className="text-theme-accent hover:underline shrink-0"
                      data-testid="prd-version-view-diff"
                    >
                      View Diff
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {diffModalFromVersion != null && (
        <div
          ref={diffModalContainerRef}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="version-diff-modal-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-theme-overlay"
            aria-label="Close diff"
            onClick={closeDiffModal}
            data-testid="version-diff-modal-backdrop"
          />
          <div
            className="relative w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col rounded-lg bg-theme-surface shadow-xl"
            data-testid="version-diff-modal-content"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-theme-border shrink-0">
              <h2 id="version-diff-modal-title" className="font-medium text-theme-text">
                Diff: v{diffModalFromVersion} → current
              </h2>
              <button
                type="button"
                onClick={closeDiffModal}
                className="px-3 py-1.5 text-sm text-theme-muted hover:text-theme-text border border-theme-border rounded"
                data-testid="version-diff-modal-close"
              >
                Close
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden p-4 flex flex-col gap-2">
              {diffLoading && (
                <p className="text-sm text-theme-muted" data-testid="version-diff-loading">
                  Loading diff…
                </p>
              )}
              {diffError && (
                <div
                  className="rounded border border-theme-error-border bg-theme-error-bg/50 p-3"
                  data-testid="version-diff-error-block"
                >
                  <p className="text-sm text-theme-error mb-2" data-testid="version-diff-error">
                    {diffError}
                  </p>
                  <button
                    type="button"
                    onClick={closeDiffModal}
                    className="text-sm px-3 py-1.5 rounded border border-theme-border bg-theme-surface text-theme-text hover:bg-theme-border-subtle"
                    data-testid="version-diff-error-close"
                  >
                    Close
                  </button>
                </div>
              )}
              {!diffLoading && !diffError && diffResult && (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    <DiffView
                      embedFullHeight
                      diff={diffResult.diff}
                      fromContent={diffResult.fromContent}
                      toContent={diffResult.toContent}
                      defaultMode="rendered"
                    />
                  </div>
                  {hasNextPage ? (
                    <div className="shrink-0 pt-2 border-t border-theme-border">
                      <button
                        type="button"
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                        className="text-sm text-accent-primary hover:underline disabled:opacity-50"
                        data-testid="prd-version-diff-load-more"
                      >
                        {isFetchingNextPage ? "Loading…" : "Load more diff"}
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
