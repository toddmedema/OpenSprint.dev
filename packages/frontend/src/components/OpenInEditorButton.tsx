import React, { useState, useRef, useEffect } from "react";
import { api } from "../api/client";

export interface OpenInEditorButtonProps {
  projectId: string;
  taskId: string;
  isInProgress: boolean;
  worktreePath: string | null;
  isBranchesMode?: boolean;
  /** "sm" for sidebar header, "icon" for compact task row */
  variant?: "sm" | "icon";
}

function getDisabledTooltip(isInProgress: boolean, worktreePath: string | null): string | null {
  if (!isInProgress) return "Task not in progress";
  if (!worktreePath) return "No active worktree";
  return null;
}

export function OpenInEditorButton({
  projectId,
  taskId,
  isInProgress,
  worktreePath,
  isBranchesMode = false,
  variant = "sm",
}: OpenInEditorButtonProps) {
  const [isOpening, setIsOpening] = useState(false);
  const [copyInfo, setCopyInfo] = useState<{ path: string; editor: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const isDisabled = !isInProgress || !worktreePath;
  const disabledTooltip = getDisabledTooltip(isInProgress, worktreePath);
  const tooltipText =
    disabledTooltip ?? (isBranchesMode ? "Open shared checkout in editor" : "Open in editor");

  useEffect(() => {
    if (!copyInfo) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setCopyInfo(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [copyInfo]);

  const handleClick = async () => {
    if (isDisabled || isOpening) return;
    setIsOpening(true);
    setError(null);
    try {
      const result = await api.tasks.openEditor(projectId, taskId);
      if (window.electron?.openInEditor) {
        const editorArg: "vscode" | "cursor" | "auto" =
          result.editor === "vscode" || result.editor === "cursor" ? result.editor : "auto";
        const ipcResult = await window.electron.openInEditor(result.worktreePath, editorArg);
        if (!ipcResult.success) {
          setError(ipcResult.error || "Failed to open editor");
        }
      } else {
        setCopyInfo({ path: result.worktreePath, editor: result.editor });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open editor");
    } finally {
      setIsOpening(false);
    }
  };

  const handleCopyPath = async () => {
    if (copyInfo) {
      await navigator.clipboard.writeText(copyInfo.path);
    }
  };

  const editorCmd = copyInfo?.editor === "cursor" ? "cursor" : "code";

  const spinnerIcon =
    variant === "icon" ? (
      <span
        className="inline-block w-3.5 h-3.5 border-2 border-theme-border border-t-brand-500 rounded-full animate-spin"
        aria-hidden
        data-testid="open-editor-spinner"
      />
    ) : (
      <span
        className="inline-block w-4 h-4 border-2 border-theme-border border-t-brand-500 rounded-full animate-spin"
        aria-hidden
        data-testid="open-editor-spinner"
      />
    );

  const externalLinkIcon = (
    <svg
      className={variant === "icon" ? "w-3.5 h-3.5" : "w-4 h-4"}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );

  const copyPopover = copyInfo ? (
    <div
      ref={popoverRef}
      className="absolute right-0 top-full mt-1 z-50 bg-theme-surface rounded-lg shadow-lg ring-1 ring-theme-border p-3 min-w-[280px]"
      data-testid="copy-path-popover"
    >
      <p className="text-xs text-theme-muted mb-1">Worktree path:</p>
      <div className="flex items-center gap-1 mb-2">
        <code className="flex-1 text-xs bg-theme-surface-muted px-2 py-1 rounded truncate">
          {copyInfo.path}
        </code>
        <button
          type="button"
          onClick={() => void handleCopyPath()}
          className="shrink-0 text-xs text-brand-600 hover:text-brand-700 px-1.5 py-1 rounded hover:bg-theme-info-bg/50 transition-colors"
          data-testid="copy-path-btn"
        >
          Copy
        </button>
      </div>
      <p className="text-xs text-theme-muted">
        Open with:{" "}
        <code className="bg-theme-surface-muted px-1 rounded">
          {editorCmd} {copyInfo.path}
        </code>
      </p>
    </div>
  ) : null;

  if (variant === "icon") {
    return (
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => void handleClick()}
          disabled={isDisabled || isOpening}
          aria-label={tooltipText}
          title={tooltipText}
          className="shrink-0 text-xs text-theme-muted hover:text-theme-text px-1.5 py-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center"
          data-testid={`open-editor-btn-${taskId}`}
        >
          {isOpening ? spinnerIcon : externalLinkIcon}
        </button>
        {copyPopover}
      </div>
    );
  }

  return (
    <div className="relative shrink-0 flex items-center gap-1">
      {isBranchesMode && isInProgress && worktreePath && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
          title="This task shares the main checkout with other tasks"
          data-testid="shared-checkout-badge"
        >
          Shared checkout
        </span>
      )}
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={isDisabled || isOpening}
        aria-label={tooltipText}
        title={tooltipText}
        className="p-1.5 rounded-md text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center"
        data-testid="open-editor-btn"
      >
        {isOpening ? spinnerIcon : externalLinkIcon}
      </button>
      {copyPopover}
      {error && (
        <span className="text-xs text-theme-error-text" data-testid="open-editor-error">
          {error}
        </span>
      )}
    </div>
  );
}
