import { useCallback, useEffect, useRef, useState } from "react";
import { RenderedDiffView } from "./RenderedDiffView";

export type DiffLineType = "add" | "remove" | "context";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffResult {
  lines: DiffLine[];
  summary?: { additions: number; deletions: number };
}

export type DiffViewMode = "rendered" | "raw";

export interface DiffViewProps {
  diff: DiffResult;
  fromContent?: string;
  toContent?: string;
  defaultMode?: DiffViewMode;
  /** Use flex growth so parent controls height (e.g. HIL approval scroll column). */
  embedFullHeight?: boolean;
}

export const INITIAL_LINE_CAP = 500;

const LINE_ARIA: Record<DiffLineType, string> = {
  add: "Added line",
  remove: "Removed line",
  context: "Context line",
};

const MODES: DiffViewMode[] = ["rendered", "raw"];

export function DiffView({
  diff,
  fromContent,
  toContent,
  defaultMode = "rendered",
  embedFullHeight = false,
}: DiffViewProps) {
  const [mode, setMode] = useState<DiffViewMode>(defaultMode);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [parseErrorFallback, setParseErrorFallback] = useState(false);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const toggleRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const effectiveMode = mode === "rendered" && parseErrorFallback ? "raw" : mode;

  const { lines, summary } = diff;
  const isCapped = lines.length > INITIAL_LINE_CAP && !expanded;
  const visibleLines = isCapped ? lines.slice(0, INITIAL_LINE_CAP) : lines;
  const hiddenCount = lines.length - visibleLines.length;

  const handleToggleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const idx = MODES.indexOf(mode);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = MODES[(idx + 1) % MODES.length];
        setMode(next);
        toggleRefs.current[MODES.indexOf(next)]?.focus();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = MODES[(idx - 1 + MODES.length) % MODES.length];
        setMode(prev);
        toggleRefs.current[MODES.indexOf(prev)]?.focus();
      }
    },
    [mode]
  );

  const handleLineKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (visibleLines.length === 0) return;
      const maxIdx = visibleLines.length - 1;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => (i === null ? 0 : Math.min(i + 1, maxIdx)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => (i === null ? maxIdx : Math.max(i - 1, 0)));
      } else if (e.key === "Home") {
        e.preventDefault();
        setFocusedIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setFocusedIndex(maxIdx);
      }
    },
    [visibleLines.length]
  );

  useEffect(() => {
    if (focusedIndex === null) return;
    lineRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

  return (
    <div
      className={`rounded-lg border border-theme-border bg-theme-surface-muted overflow-hidden ${
        embedFullHeight ? "flex flex-col flex-1 min-h-0" : ""
      }`}
      data-testid="diff-view"
    >
      {/* Toggle bar */}
      <div
        className={`flex items-center gap-2 px-3 py-2 bg-theme-border-subtle/50 border-b border-theme-border ${
          embedFullHeight ? "shrink-0" : ""
        }`}
        data-testid="diff-view-toggle-bar"
      >
        {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus -- focus is managed via roving tabindex on child radio buttons */}
        <div
          role="radiogroup"
          aria-label="Diff view mode"
          className="inline-flex rounded-md border border-theme-border overflow-hidden text-xs"
          onKeyDown={handleToggleKeyDown}
        >
          {MODES.map((m, i) => (
            <button
              key={m}
              ref={(el) => {
                toggleRefs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={mode === m}
              tabIndex={mode === m ? 0 : -1}
              onClick={() => setMode(m)}
              className={`px-3 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-ring ${
                mode === m
                  ? "bg-accent-primary text-white"
                  : "bg-theme-surface text-theme-text hover:bg-theme-surface-muted"
              }`}
            >
              {m === "rendered" ? "Rendered" : "Raw"}
            </button>
          ))}
        </div>
        {summary != null && (
          <span className="ml-auto text-xs text-theme-muted" data-testid="diff-view-summary">
            +{summary.additions} −{summary.deletions}
          </span>
        )}
      </div>

      {/* Parse-error notice */}
      {parseErrorFallback && (
        <div
          className="px-3 py-1.5 text-xs bg-theme-warning-bg text-theme-warning-text border-b border-theme-border"
          data-testid="diff-view-parse-fallback-notice"
        >
          Markdown could not be parsed — showing raw diff.
        </div>
      )}

      {/* Content area */}
      {effectiveMode === "raw" ? (
        <div
          className={`font-mono text-xs overflow-x-auto overflow-y-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-ring focus-visible:ring-inset ${
            embedFullHeight ? "min-h-0 flex-1 max-h-full" : "max-h-[24rem]"
          }`}
          role="textbox"
          tabIndex={0}
          aria-label="Diff lines"
          onKeyDown={handleLineKeyDown}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setFocusedIndex(null);
          }}
          data-testid="diff-view-raw"
        >
          {lines.length === 0 ? (
            <div className="p-3 text-theme-muted" data-testid="diff-view-no-changes">
              No changes
            </div>
          ) : (
            <>
              <pre className="m-0 p-0 whitespace-pre-wrap break-words">
                {visibleLines.map((line, i) => {
                  const isAdd = line.type === "add";
                  const isRemove = line.type === "remove";
                  const bg = isAdd ? "bg-theme-success-bg" : isRemove ? "bg-theme-error-bg" : "";
                  const textColor = isAdd
                    ? "text-theme-success-text"
                    : isRemove
                      ? "text-theme-error-text"
                      : "text-theme-text";
                  const marker = isAdd ? "+" : isRemove ? "-" : " ";
                  const ariaLabel = LINE_ARIA[line.type];
                  const oldNum = line.oldLineNumber != null ? String(line.oldLineNumber) : "";
                  const newNum = line.newLineNumber != null ? String(line.newLineNumber) : "";
                  return (
                    <div
                      key={i}
                      ref={(el) => {
                        lineRefs.current[i] = el;
                      }}
                      role="listitem"
                      aria-label={`${ariaLabel}: ${line.text.slice(0, 80)}${line.text.length > 80 ? "…" : ""}`}
                      tabIndex={-1}
                      className={`flex min-w-0 border-l-2 ${isAdd ? "border-l-theme-success-border" : isRemove ? "border-l-theme-error-border" : "border-l-transparent"} ${bg} ${textColor} ${focusedIndex === i ? "ring-1 ring-inset ring-theme-ring" : ""}`}
                      data-line-type={line.type}
                    >
                      <span
                        className="shrink-0 w-10 text-right pr-2 py-0.5 text-theme-muted select-none"
                        aria-hidden="true"
                        data-testid={`line-old-${i}`}
                      >
                        {oldNum}
                      </span>
                      <span
                        className="shrink-0 w-10 text-right pr-2 py-0.5 text-theme-muted select-none border-r border-theme-border-subtle"
                        aria-hidden="true"
                        data-testid={`line-new-${i}`}
                      >
                        {newNum}
                      </span>
                      <span
                        className="shrink-0 w-4 text-center py-0.5 select-none"
                        aria-hidden="true"
                        data-testid={`line-marker-${i}`}
                      >
                        {marker}
                      </span>
                      <span className="flex-1 py-0.5 pl-1">{line.text || "\u00a0"}</span>
                    </div>
                  );
                })}
              </pre>
              {isCapped && (
                <div className="px-3 py-2 border-t border-theme-border bg-theme-surface-muted">
                  <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="text-sm text-accent-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-ring rounded"
                    data-testid="diff-view-show-more"
                  >
                    Show more ({hiddenCount} more line{hiddenCount !== 1 ? "s" : ""})
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : fromContent != null && toContent != null ? (
        <div
          className={embedFullHeight ? "flex flex-1 min-h-0 flex-col overflow-hidden" : undefined}
        >
          <RenderedDiffView
            fromContent={fromContent}
            toContent={toContent}
            onParseError={() => setParseErrorFallback(true)}
            fillContainer={embedFullHeight}
          />
        </div>
      ) : (
        <div className="p-4 text-sm text-theme-muted" data-testid="diff-view-rendered-placeholder">
          Rendered diff requires fromContent and toContent.
        </div>
      )}
    </div>
  );
}
