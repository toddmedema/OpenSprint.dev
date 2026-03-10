import { useCallback, useEffect, useState } from "react";
import { formatSectionKey, formatTimestamp } from "../../lib/formatting";
import { getPrdSourceColor, PRD_SOURCE_LABELS } from "../../lib/constants";
import { api } from "../../api/client";
import { ServerDiffView } from "./ServerDiffView";
import type { ServerDiffResult } from "./ServerDiffView";

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
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<{ diff: ServerDiffResult; fromVersion: string; toVersion: string } | null>(null);

  const closeDiffModal = useCallback(() => {
    setDiffModalFromVersion(null);
    setDiffError(null);
    setDiffResult(null);
  }, []);

  useEffect(() => {
    if (diffModalFromVersion == null) return;
    setDiffLoading(true);
    setDiffError(null);
    setDiffResult(null);
    api.prd
      .getVersionDiff(projectId, String(diffModalFromVersion))
      .then((res) => {
        setDiffResult({
          diff: res.diff,
          fromVersion: res.fromVersion,
          toVersion: res.toVersion,
        });
      })
      .catch((err) => {
        setDiffError(err instanceof Error ? err.message : "Failed to load diff");
      })
      .finally(() => {
        setDiffLoading(false);
      });
  }, [projectId, diffModalFromVersion]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && diffModalFromVersion != null) closeDiffModal();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [diffModalFromVersion, closeDiffModal]);

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
                      onClick={() => setDiffModalFromVersion(entry.documentVersion!)}
                      className="text-theme-accent hover:underline shrink-0"
                      data-testid="compare-to-current"
                    >
                      Compare to current
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {diffModalFromVersion != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="version-diff-modal-title">
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
            <div className="flex-1 min-h-0 overflow-auto p-4">
              {diffLoading && (
                <p className="text-sm text-theme-muted" data-testid="version-diff-loading">Loading diff…</p>
              )}
              {diffError && (
                <p className="text-sm text-theme-error" data-testid="version-diff-error">{diffError}</p>
              )}
              {!diffLoading && !diffError && diffResult && (
                <ServerDiffView
                  diff={diffResult.diff}
                  fromVersion={diffResult.fromVersion}
                  toVersion={diffResult.toVersion}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
