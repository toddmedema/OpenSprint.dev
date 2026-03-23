import React from "react";
import { CloseButton } from "../CloseButton";
import { shouldRightAlignDropdown } from "../../lib/dropdownViewport";

export interface TaskDetailHeaderProps {
  title: string;
  hasActions: boolean;
  isBlockedTask: boolean;
  isDoneTask: boolean;
  markDoneLoading: boolean;
  unblockLoading: boolean;
  deleteLoading: boolean;
  onClose: () => void;
  onMarkDone: () => void;
  onUnblock: () => void;
  onDeleteTask: () => void | Promise<void>;
  deleteConfirmOpen: boolean;
  setDeleteConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>;
  deleteLinkConfirm: {
    targetId: string;
    type: string;
    taskName: string;
  } | null;
  setDeleteLinkConfirm: React.Dispatch<
    React.SetStateAction<{
      targetId: string;
      type: string;
      taskName: string;
    } | null>
  >;
  removeLinkRemovingId: string | null;
  onRemoveLink: (targetId: string) => Promise<void>;
}

export function TaskDetailHeader({
  title,
  hasActions,
  isBlockedTask,
  isDoneTask,
  markDoneLoading,
  unblockLoading,
  deleteLoading,
  onClose,
  onMarkDone,
  onUnblock,
  onDeleteTask,
  deleteConfirmOpen,
  setDeleteConfirmOpen,
  deleteLinkConfirm,
  setDeleteLinkConfirm,
  removeLinkRemovingId,
  onRemoveLink,
}: TaskDetailHeaderProps) {
  const [actionsMenuOpen, setActionsMenuOpen] = React.useState(false);
  const [actionsMenuAlignRight, setActionsMenuAlignRight] = React.useState(false);
  const actionsMenuRef = React.useRef<HTMLDivElement>(null);
  const actionsMenuTriggerRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!actionsMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setActionsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [actionsMenuOpen]);

  React.useEffect(() => {
    if (actionsMenuOpen && actionsMenuTriggerRef.current) {
      setActionsMenuAlignRight(
        shouldRightAlignDropdown(actionsMenuTriggerRef.current.getBoundingClientRect())
      );
    }
  }, [actionsMenuOpen]);

  const handleConfirmDeleteTask = async () => {
    await onDeleteTask();
    setDeleteConfirmOpen(false);
  };

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-4 pb-2 shrink-0 min-h-0 flex-nowrap">
        <div className="min-w-0 flex-1">
          <h3
            className="font-semibold text-theme-text truncate block"
            data-testid="task-detail-title"
          >
            {title}
          </h3>
        </div>
        {hasActions && (
          <div ref={actionsMenuRef} className="relative shrink-0">
            <button
              ref={actionsMenuTriggerRef}
              type="button"
              onClick={() => setActionsMenuOpen((o) => !o)}
              className="p-1.5 rounded-md text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle transition-colors"
              aria-label="Task actions"
              aria-haspopup="menu"
              aria-expanded={actionsMenuOpen}
              data-testid="sidebar-actions-menu-trigger"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
              </svg>
            </button>
            {actionsMenuOpen && (
              <ul
                role="menu"
                className={`dropdown-menu-elevated dropdown-menu-surface absolute top-full mt-1 min-w-[140px] ${actionsMenuAlignRight ? "right-0 left-auto" : "left-0 right-auto"}`}
                data-testid="sidebar-actions-menu"
              >
                {isBlockedTask && (
                  <li role="none">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onUnblock();
                      }}
                      disabled={unblockLoading}
                      aria-busy={unblockLoading}
                      aria-label={unblockLoading ? "Retrying" : "Retry"}
                      className="dropdown-item w-full flex items-center justify-center gap-2 text-left text-xs text-theme-error-text hover:bg-theme-error-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[2rem]"
                      data-testid="sidebar-retry-btn"
                    >
                      {unblockLoading ? (
                        <span
                          className="inline-block w-4 h-4 border-2 border-theme-border border-t-brand-500 rounded-full animate-spin shrink-0"
                          aria-hidden
                          data-testid="sidebar-retry-spinner"
                        />
                      ) : (
                        "Retry"
                      )}
                    </button>
                  </li>
                )}
                {!isDoneTask && !isBlockedTask && (
                  <li role="none">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onMarkDone();
                        setActionsMenuOpen(false);
                      }}
                      disabled={markDoneLoading}
                      className="dropdown-item w-full flex items-center gap-2 text-left text-xs font-medium text-brand-600 hover:bg-theme-border-subtle/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      data-testid="sidebar-mark-done-btn"
                    >
                      {markDoneLoading ? "Marking…" : "Mark done"}
                    </button>
                  </li>
                )}
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setDeleteConfirmOpen(true);
                      setActionsMenuOpen(false);
                    }}
                    disabled={deleteLoading}
                    className="dropdown-item w-full flex items-center gap-2 text-left text-xs text-theme-error-text hover:bg-theme-error-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="sidebar-delete-task-btn"
                  >
                    {deleteLoading ? "Deleting..." : "Delete"}
                  </button>
                </li>
              </ul>
            )}
          </div>
        )}
        <div className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center">
          <CloseButton onClick={onClose} ariaLabel="Close task detail" />
        </div>
      </div>

      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close delete task confirmation"
            onClick={() => setDeleteConfirmOpen(false)}
            className="absolute inset-0 bg-theme-overlay backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-task-confirm-title"
            className="relative bg-theme-surface rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto flex flex-col"
            data-testid="sidebar-delete-task-dialog"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border shrink-0">
              <h2 id="delete-task-confirm-title" className="text-lg font-semibold text-theme-text">
                Delete task
              </h2>
              <CloseButton
                onClick={() => setDeleteConfirmOpen(false)}
                ariaLabel="Close delete task confirmation"
              />
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-theme-text">
                Delete this task permanently? This also removes links and references to this task.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-theme-border bg-theme-bg rounded-b-xl">
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
                className="btn-secondary"
                data-testid="sidebar-delete-task-cancel-btn"
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleConfirmDeleteTask();
                }}
                className="btn-primary disabled:opacity-50"
                data-testid="sidebar-delete-task-confirm-btn"
                disabled={deleteLoading}
              >
                {deleteLoading ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteLinkConfirm && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close delete link confirmation"
            onClick={() => setDeleteLinkConfirm(null)}
            className="absolute inset-0 bg-theme-overlay backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-link-confirm-title"
            className="relative bg-theme-surface rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto flex flex-col"
            data-testid="sidebar-delete-link-dialog"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border shrink-0">
              <h2 id="delete-link-confirm-title" className="text-lg font-semibold text-theme-text">
                Remove link
              </h2>
              <CloseButton
                onClick={() => setDeleteLinkConfirm(null)}
                ariaLabel="Close delete link confirmation"
              />
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-theme-text">
                Are you sure you want to delete the{" "}
                {deleteLinkConfirm.type === "blocks"
                  ? "Blocked on"
                  : deleteLinkConfirm.type === "parent-child"
                    ? "Parent"
                    : "Related"}{" "}
                link to {deleteLinkConfirm.taskName}?
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-theme-border bg-theme-bg rounded-b-xl">
              <button
                type="button"
                onClick={() => setDeleteLinkConfirm(null)}
                className="btn-secondary"
                data-testid="sidebar-delete-link-cancel-btn"
                disabled={removeLinkRemovingId !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const { targetId } = deleteLinkConfirm;
                  await onRemoveLink(targetId);
                }}
                className="btn-primary disabled:opacity-50"
                data-testid="sidebar-delete-link-confirm-btn"
                disabled={removeLinkRemovingId !== null}
              >
                {removeLinkRemovingId ? "Removing..." : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
