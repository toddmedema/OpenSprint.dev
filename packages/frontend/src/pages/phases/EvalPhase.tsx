import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import type { FeedbackItem, KanbanColumn } from "@opensprint/shared";
import { PRIORITY_LABELS } from "@opensprint/shared";
import { useAppDispatch, useAppSelector } from "../../store";
import { submitFeedback, resolveFeedback, removeFeedbackItem } from "../../store/slices/evalSlice";
import { selectTaskSummariesByProject } from "../../store/slices/taskRegistrySlice";
import { TaskStatusBadge, COLUMN_LABELS } from "../../components/kanban";
import { TaskLinkDisplay } from "../../components/TaskLinkDisplay";
import { KeyboardShortcutTooltip } from "../../components/KeyboardShortcutTooltip";
import { PriorityIcon } from "../../components/PriorityIcon";
import { ImageAttachmentThumbnails, ImageAttachmentButton } from "../../components/ImageAttachment";
import { useImageAttachment } from "../../hooks/useImageAttachment";
import { useSubmitShortcut } from "../../hooks/useSubmitShortcut";

/** Reply icon (message turn / corner up-right) */
function ReplyIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="9 10 4 15 9 20" />
      <path d="M20 4v7a4 4 0 0 1-4 4H4" />
    </svg>
  );
}

export const FEEDBACK_COLLAPSED_KEY_PREFIX = "opensprint-eval-feedback-collapsed";
export const EVALUATE_FEEDBACK_FILTER_KEY = "opensprint.evaluateFeedbackFilter";

function getFeedbackCollapsedKey(projectId: string): string {
  return `${FEEDBACK_COLLAPSED_KEY_PREFIX}-${projectId}`;
}

function loadFeedbackCollapsedIds(projectId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(getFeedbackCollapsedKey(projectId));
    if (!stored) return new Set();
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveFeedbackCollapsedIds(projectId: string, ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getFeedbackCollapsedKey(projectId), JSON.stringify([...ids]));
  } catch {
    // ignore
  }
}

interface EvalPhaseProps {
  projectId: string;
  onNavigateToBuildTask?: (taskId: string) => void;
}

export type FeedbackStatusFilter = "all" | "pending" | "resolved";

function matchesStatusFilter(item: FeedbackItem, filter: FeedbackStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "pending") return item.status === "pending" || item.status === "mapped";
  if (filter === "resolved") return item.status === "resolved";
  return true;
}

function countByStatus(feedback: FeedbackItem[], filter: FeedbackStatusFilter): number {
  if (filter === "all") return feedback.length;
  return feedback.filter((item) => matchesStatusFilter(item, filter)).length;
}

const VALID_FILTER_VALUES: FeedbackStatusFilter[] = ["all", "pending", "resolved"];

function loadFeedbackStatusFilter(): FeedbackStatusFilter {
  if (typeof window === "undefined") return "all";
  try {
    const stored = localStorage.getItem(EVALUATE_FEEDBACK_FILTER_KEY);
    if (!stored) return "all";
    if (VALID_FILTER_VALUES.includes(stored as FeedbackStatusFilter)) {
      return stored as FeedbackStatusFilter;
    }
    // Legacy value: "mapped" collapses to "pending"
    if (stored === "mapped") return "pending";
  } catch {
    // ignore
  }
  return "all";
}

function saveFeedbackStatusFilter(value: FeedbackStatusFilter): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(EVALUATE_FEEDBACK_FILTER_KEY, value);
  } catch {
    // ignore
  }
}

const categoryColors: Record<string, string> = {
  bug: "bg-theme-feedback-bug-bg text-theme-feedback-bug-text",
  feature: "bg-theme-feedback-feature-bg text-theme-feedback-feature-text",
  ux: "bg-theme-feedback-ux-bg text-theme-feedback-ux-text",
  scope: "bg-theme-feedback-scope-bg text-theme-feedback-scope-text",
};

/** Display label for feedback type chip (Bug/Feature/UX/Scope). */
function getFeedbackTypeLabel(item: FeedbackItem): string {
  return item.category === "ux"
    ? "UX"
    : item.category.charAt(0).toUpperCase() + item.category.slice(1);
}

/** Tree node for feedback display (parent + children) */
interface FeedbackTreeNode {
  item: FeedbackItem;
  children: FeedbackTreeNode[];
}

/** Build tree from flat feedback list. Top-level first, then children by createdAt desc.
 * Items whose parent is not in the list are shown at top level (e.g. when filtering). */
function buildFeedbackTree(items: FeedbackItem[]): FeedbackTreeNode[] {
  const idSet = new Set(items.map((i) => i.id));
  const byParent = new Map<string | null, FeedbackItem[]>();
  for (const item of items) {
    let pid = item.parent_id ?? null;
    if (pid !== null && !idSet.has(pid)) pid = null;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(item);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }
  function build(pid: string | null): FeedbackTreeNode[] {
    const list = byParent.get(pid) ?? [];
    return list.map((item) => ({
      item,
      children: build(item.id),
    }));
  }
  return build(null);
}

interface FeedbackCardProps {
  node: FeedbackTreeNode;
  depth: number;
  projectId: string;
  getTaskColumn: (taskId: string) => KanbanColumn;
  getTaskPriority: (taskId: string) => number;
  getTaskTitle?: (taskId: string) => string | undefined;
  onNavigateToBuildTask?: (taskId: string) => void;
  replyingToId: string | null;
  onStartReply: (id: string) => void;
  onCancelReply: () => void;
  onSubmitReply: (parentId: string, text: string, images?: string[]) => void;
  onResolve: (feedbackId: string) => void;
  onRemoveAfterAnimation: (feedbackId: string) => void;
  collapsedIds: Set<string>;
  onToggleCollapse: (id: string) => void;
  submitting: boolean;
}

const RESOLVE_COLLAPSE_DURATION_MS = 1000;
const RESOLVE_COLLAPSE_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

function FeedbackCard({
  node,
  depth,
  projectId,
  getTaskColumn,
  getTaskPriority,
  getTaskTitle,
  onNavigateToBuildTask,
  replyingToId,
  onStartReply,
  onCancelReply,
  onSubmitReply,
  onResolve,
  onRemoveAfterAnimation,
  collapsedIds,
  onToggleCollapse,
  submitting,
}: FeedbackCardProps) {
  const { item, children } = node;
  const [replyText, setReplyText] = useState("");
  const replyImages = useImageAttachment();
  const isReplying = replyingToId === item.id;
  const isCollapsed = collapsedIds.has(item.id);
  const hasChildren = children.length > 0;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [collapseHeight, setCollapseHeight] = useState<number | null>(null);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const prevStatusRef = useRef(item.status);

  useEffect(() => {
    const justResolved = item.status === "resolved" && prevStatusRef.current !== "resolved";
    prevStatusRef.current = item.status;

    if (!justResolved || isAnimatingOut) return;
    const el = wrapperRef.current;
    if (!el) return;

    const startCollapse = () => {
      const height = el.offsetHeight;
      setCollapseHeight(height);
      setIsAnimatingOut(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setCollapseHeight(0);
        });
      });
    };

    startCollapse();
  }, [item.status, isAnimatingOut]);

  const removeRef = useRef<(() => void) | undefined>(undefined);
  removeRef.current = () => onRemoveAfterAnimation(item.id);

  const handleTransitionEnd = useCallback((e: React.TransitionEvent) => {
    if (e.propertyName !== "height") return;
    removeRef.current?.();
  }, []);

  useEffect(() => {
    if (collapseHeight !== 0 || !isAnimatingOut) return;
    const fallback = setTimeout(() => {
      removeRef.current?.();
    }, RESOLVE_COLLAPSE_DURATION_MS + 100);
    return () => clearTimeout(fallback);
  }, [collapseHeight, isAnimatingOut]);

  const handleSubmitReply = () => {
    if (!replyText.trim() || submitting) return;
    const imagePayload = replyImages.images.length > 0 ? replyImages.images : undefined;
    onSubmitReply(item.id, replyText.trim(), imagePayload);
    setReplyText("");
    replyImages.reset();
    onCancelReply();
  };

  const onKeyDownReply = useSubmitShortcut(handleSubmitReply, {
    multiline: true,
    disabled: !replyText.trim() || submitting,
  });

  const isResolvedAndAnimating = item.status === "resolved" && collapseHeight !== null;

  const wrapperStyle: React.CSSProperties = isResolvedAndAnimating
    ? {
        height: collapseHeight,
        overflow: "hidden",
        margin: 0,
        transition: `height ${RESOLVE_COLLAPSE_DURATION_MS}ms ${RESOLVE_COLLAPSE_EASING}`,
      }
    : {};

  return (
    <div
      ref={wrapperRef}
      style={wrapperStyle}
      onTransitionEnd={handleTransitionEnd}
      className={depth > 0 ? "ml-4 mt-2 border-l-2 border-theme-border pl-4" : ""}
    >
      <div className="card p-4">
        {/* Category badge/spinner floats top-right */}
        <div className="mb-2 overflow-hidden">
          {item.status === "pending" ? (
            <span
              className="float-right ml-2 mb-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium bg-theme-border-subtle text-theme-muted flex-shrink-0"
              aria-label="Categorizing feedback"
            >
              <div
                className="h-3 w-3 border-2 border-theme-ring border-t-transparent rounded-full animate-spin"
                aria-hidden="true"
              />
              Categorizing…
            </span>
          ) : (
            <>
              {item.status === "resolved" && (
                <span
                  className="float-right ml-2 mb-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0 bg-theme-success-bg text-theme-success-text"
                  aria-label="Resolved"
                >
                  Resolved
                </span>
              )}
              <span
                className={`float-right ml-2 mb-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0 ${
                  categoryColors[item.category] ?? "bg-theme-border-subtle text-theme-muted"
                }`}
              >
                {getFeedbackTypeLabel(item)}
              </span>
            </>
          )}
          <p className="text-sm text-theme-text whitespace-pre-wrap break-words min-w-0">
            {item.text ?? "(No feedback text)"}
          </p>
        </div>

        {item.images && item.images.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {item.images.map((dataUrl, i) => (
              <img
                key={i}
                src={dataUrl}
                alt={`Attachment ${i + 1}`}
                className="h-16 w-16 object-cover rounded border border-theme-border"
              />
            ))}
          </div>
        )}

        {/* Ticket info on left, action buttons (Reply, Resolve, etc.) on right — same line */}
        <div
          className="mt-1 flex flex-wrap items-center justify-between gap-2"
          data-testid="feedback-card-actions-row"
        >
          {item.createdTaskIds.length > 0 && (
            <div className="flex gap-1 flex-wrap min-w-0" data-testid="feedback-card-ticket-info">
              {item.createdTaskIds.map((taskId) => {
                const column = getTaskColumn(taskId);
                const statusLabel = COLUMN_LABELS[column];
                const taskPriority = getTaskPriority(taskId);
                const linkContent = onNavigateToBuildTask ? (
                  <button
                    key={taskId}
                    type="button"
                    onClick={() => onNavigateToBuildTask(taskId)}
                    className="inline-flex items-center gap-1.5 rounded bg-theme-border-subtle px-1.5 py-0.5 text-xs font-mono text-brand-600 hover:bg-theme-info-bg hover:text-theme-info-text underline transition-colors"
                  >
                    <PriorityIcon priority={taskPriority} size="xs" />
                    <TaskStatusBadge column={column} size="xs" />
                    <span
                      className="text-theme-muted font-sans font-normal no-underline"
                      aria-label={`Status: ${statusLabel}`}
                    >
                      {statusLabel}
                    </span>
                    <TaskLinkDisplay
                      projectId={projectId}
                      taskId={taskId}
                      cachedTitle={getTaskTitle?.(taskId)}
                    />
                  </button>
                ) : (
                  <span
                    key={taskId}
                    className="inline-flex items-center gap-1.5 rounded bg-theme-border-subtle px-1.5 py-0.5 text-xs font-mono text-theme-muted"
                  >
                    <PriorityIcon priority={taskPriority} size="xs" />
                    <TaskStatusBadge column={column} size="xs" />
                    <span
                      className="text-theme-muted font-sans font-normal"
                      aria-label={`Status: ${statusLabel}`}
                    >
                      {statusLabel}
                    </span>
                    <TaskLinkDisplay
                      projectId={projectId}
                      taskId={taskId}
                      cachedTitle={getTaskTitle?.(taskId)}
                    />
                  </span>
                );
                return linkContent;
              })}
            </div>
          )}
          <div className="flex gap-2 flex-shrink-0 ml-auto">
            {item.status === "mapped" && (
              <button
                type="button"
                onClick={() => onResolve(item.id)}
                className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-theme-success-text hover:bg-theme-success-bg transition-colors"
                title="Mark as resolved"
                aria-label="Resolve"
              >
                Resolve
              </button>
            )}
            <button
              type="button"
              onClick={() => (isReplying ? onCancelReply() : onStartReply(item.id))}
              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-theme-muted hover:bg-theme-border-subtle hover:text-theme-text transition-colors"
              title="Reply"
              aria-label={isReplying ? "Cancel reply" : "Reply"}
            >
              <ReplyIcon className="w-4 h-4" />
              {isReplying ? "Cancel" : "Reply"}
            </button>
            {hasChildren && (
              <button
                type="button"
                onClick={() => onToggleCollapse(item.id)}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-theme-muted hover:bg-theme-border-subtle hover:text-theme-text transition-colors"
                aria-label={isCollapsed ? "Expand replies" : "Collapse replies"}
              >
                {isCollapsed ? "Expand" : "Collapse"} ({children.length}{" "}
                {children.length === 1 ? "reply" : "replies"})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Inline reply composer (PRD §7.4.1: quote snippet of parent above text input) */}
      {isReplying && (
        <div
          className="mt-2 ml-0 card p-3"
          onDragOver={replyImages.handleDragOver}
          onDrop={replyImages.handleDrop}
        >
          <blockquote className="mb-2 pl-3 border-l-2 border-theme-border text-sm text-theme-muted italic">
            {item.text && item.text.length > 80
              ? `${item.text.slice(0, 80)}…`
              : item.text || "(No feedback text)"}
          </blockquote>
          <textarea
            className="input min-h-[60px] mb-2 text-sm"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onPaste={replyImages.handlePaste}
            onKeyDown={(e) => {
              onKeyDownReply(e);
              if (e.key === "Escape") {
                e.preventDefault();
                onCancelReply();
              }
            }}
            placeholder="Write a reply..."
            disabled={submitting}
            autoFocus
          />
          <ImageAttachmentThumbnails attachment={replyImages} className="mb-2" />
          <div className="flex justify-end items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onCancelReply}
              className="btn-secondary text-sm py-1 px-2"
            >
              Cancel
            </button>
            <ImageAttachmentButton
              attachment={replyImages}
              variant="text"
              disabled={submitting}
              data-testid="reply-attach-images"
            />
            <button
              type="button"
              onClick={handleSubmitReply}
              disabled={submitting || !replyText.trim()}
              className="btn-primary text-sm py-1 px-2 disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit Reply"}
            </button>
          </div>
        </div>
      )}

      {/* Nested children (hidden when collapsed) */}
      {!isCollapsed &&
        children.map((child) => (
          <FeedbackCard
            key={child.item.id}
            node={child}
            depth={depth + 1}
            projectId={projectId}
            getTaskColumn={getTaskColumn}
            getTaskPriority={getTaskPriority}
            getTaskTitle={getTaskTitle}
            onNavigateToBuildTask={onNavigateToBuildTask}
            replyingToId={replyingToId}
            onStartReply={onStartReply}
            onCancelReply={onCancelReply}
            onSubmitReply={onSubmitReply}
            onResolve={onResolve}
            onRemoveAfterAnimation={onRemoveAfterAnimation}
            collapsedIds={collapsedIds}
            onToggleCollapse={onToggleCollapse}
            submitting={submitting}
          />
        ))}
    </div>
  );
}

export function EvalPhase({ projectId, onNavigateToBuildTask }: EvalPhaseProps) {
  const dispatch = useAppDispatch();

  /* ── Redux state ── */
  const feedback = useAppSelector((s) => s.eval.feedback);
  const taskSummaries = useAppSelector((s) => selectTaskSummariesByProject(s, projectId));
  const loading = useAppSelector((s) => s.eval.loading);
  const submitting = useAppSelector((s) => s.eval.submitting);

  const getTaskColumn = useCallback(
    (taskId: string): KanbanColumn => {
      return taskSummaries[taskId]?.kanbanColumn ?? "backlog";
    },
    [taskSummaries]
  );

  const getTaskTitle = useCallback(
    (taskId: string): string | undefined => {
      return taskSummaries[taskId]?.title;
    },
    [taskSummaries]
  );

  const getTaskPriority = useCallback(
    (taskId: string): number => {
      return taskSummaries[taskId]?.priority ?? 1;
    },
    [taskSummaries]
  );

  /* ── Local UI state (preserved by mount-all) ── */
  const [input, setInput] = useState("");
  const imageAttachment = useImageAttachment();
  const [priority, setPriority] = useState<number | null>(null);
  const [feedbackPriorityDropdownOpen, setFeedbackPriorityDropdownOpen] = useState(false);
  const feedbackPriorityDropdownRef = useRef<HTMLDivElement>(null);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() =>
    loadFeedbackCollapsedIds(projectId)
  );
  const [statusFilter, setStatusFilter] = useState<FeedbackStatusFilter>(() =>
    loadFeedbackStatusFilter()
  );

  const handleSubmit = async () => {
    if (!input.trim() || submitting) return;
    const text = input.trim();
    const imagePayload = imageAttachment.images.length > 0 ? imageAttachment.images : undefined;
    const priorityPayload = priority != null ? priority : undefined;
    setInput("");
    imageAttachment.reset();
    setPriority(null);
    await dispatch(
      submitFeedback({ projectId, text, images: imagePayload, priority: priorityPayload })
    );
  };

  const onKeyDownFeedback = useSubmitShortcut(handleSubmit, {
    multiline: true,
    disabled: !input.trim() || submitting,
  });

  const handleSubmitReply = useCallback(
    async (parentId: string, text: string, images?: string[]) => {
      if (!text.trim() || submitting) return;
      await dispatch(submitFeedback({ projectId, text, images, parentId }));
    },
    [dispatch, projectId, submitting]
  );

  useEffect(() => {
    if (!feedbackPriorityDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        feedbackPriorityDropdownRef.current &&
        !feedbackPriorityDropdownRef.current.contains(e.target as Node)
      ) {
        setFeedbackPriorityDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFeedbackPriorityDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [feedbackPriorityDropdownOpen]);

  const feedbackFeedRef = useRef<HTMLDivElement>(null);

  const handleResolve = useCallback(
    (feedbackId: string) => {
      const scrollEl = feedbackFeedRef.current;
      const scrollTop = scrollEl?.scrollTop ?? 0;
      dispatch(resolveFeedback({ projectId, feedbackId }));
      // Restore scroll after React re-renders; double rAF ensures we run after paint
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollEl) scrollEl.scrollTop = scrollTop;
        });
      });
    },
    [dispatch, projectId]
  );

  const handleRemoveAfterAnimation = useCallback(
    (feedbackId: string) => {
      dispatch(removeFeedbackItem(feedbackId));
    },
    [dispatch]
  );

  const handleToggleCollapse = useCallback(
    (id: string) => {
      setCollapsedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        saveFeedbackCollapsedIds(projectId, next);
        return next;
      });
    },
    [projectId]
  );

  const filteredFeedback = useMemo(
    () => feedback.filter((item) => matchesStatusFilter(item, statusFilter)),
    [feedback, statusFilter]
  );
  const feedbackTree = useMemo(() => buildFeedbackTree(filteredFeedback), [filteredFeedback]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div
        ref={feedbackFeedRef}
        className="flex-1 min-h-0 overflow-y-auto"
        data-testid="eval-feedback-feed-scroll"
      >
        <div className="max-w-3xl mx-auto px-6 py-8">
          {/* Feedback Input */}
          <div
            className="card p-5 mb-8"
            onDragOver={imageAttachment.handleDragOver}
            onDrop={imageAttachment.handleDrop}
          >
            <label className="block text-sm font-medium text-theme-text mb-2">
              What did you find?
            </label>
            <textarea
              className="input min-h-[100px] mb-3"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={imageAttachment.handlePaste}
              onKeyDown={onKeyDownFeedback}
              placeholder="Describe a bug, suggest a feature, or report a UX issue..."
              disabled={submitting}
            />
            <ImageAttachmentThumbnails attachment={imageAttachment} className="mb-3" />
            <div className="flex justify-end items-stretch gap-2 flex-wrap">
              <div ref={feedbackPriorityDropdownRef} className="relative shrink-0 flex">
                <button
                  type="button"
                  onClick={() => !submitting && setFeedbackPriorityDropdownOpen((o) => !o)}
                  disabled={submitting}
                  className="input text-sm h-10 min-h-10 py-2.5 px-3 w-auto min-w-[10rem] inline-flex items-center gap-2 bg-theme-input-bg text-theme-input-text ring-theme-ring"
                  aria-label="Priority (optional)"
                  aria-haspopup="listbox"
                  aria-expanded={feedbackPriorityDropdownOpen}
                  data-testid="feedback-priority-select"
                >
                  {priority != null ? (
                    <>
                      <PriorityIcon priority={priority} size="sm" />
                      <span className="flex-1 text-left">{PRIORITY_LABELS[priority]}</span>
                    </>
                  ) : (
                    <span className="flex-1 text-left text-theme-muted">Priority (optional)</span>
                  )}
                  <span className="text-[10px] opacity-70 shrink-0">
                    {feedbackPriorityDropdownOpen ? "▲" : "▼"}
                  </span>
                </button>
                {feedbackPriorityDropdownOpen && (
                  <ul
                    role="listbox"
                    className="absolute left-0 top-full mt-1 z-50 min-w-[10rem] rounded-lg border border-theme-border bg-theme-surface shadow-lg py-1"
                    data-testid="feedback-priority-dropdown"
                  >
                    <li role="option">
                      <button
                        type="button"
                        onClick={() => {
                          setPriority(null);
                          setFeedbackPriorityDropdownOpen(false);
                        }}
                        className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs hover:bg-theme-border-subtle/50 transition-colors text-theme-muted"
                        data-testid="feedback-priority-option-clear"
                      >
                        No priority
                      </button>
                    </li>
                    {([0, 1, 2, 3, 4] as const).map((p) => (
                      <li key={p} role="option">
                        <button
                          type="button"
                          onClick={() => {
                            setPriority(p);
                            setFeedbackPriorityDropdownOpen(false);
                          }}
                          className={`w-full flex items-center gap-2 text-left px-3 py-2 text-xs hover:bg-theme-border-subtle/50 transition-colors ${
                            priority === p ? "text-brand-600 font-medium" : "text-theme-text"
                          }`}
                          data-testid={`feedback-priority-option-${p}`}
                        >
                          <PriorityIcon priority={p} size="sm" />
                          {PRIORITY_LABELS[p]}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <ImageAttachmentButton
                attachment={imageAttachment}
                variant="icon"
                disabled={submitting}
                data-testid="feedback-attach-image"
              />
              <KeyboardShortcutTooltip>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !input.trim()}
                  className="btn-primary h-10 disabled:opacity-50"
                >
                  {submitting ? "Submitting..." : "Submit Feedback"}
                </button>
              </KeyboardShortcutTooltip>
            </div>
          </div>

          {/* Feedback Feed */}
          <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
            <h3 className="text-sm font-semibold text-theme-text">Feedback History</h3>
            {feedback.length > 0 && (
              <select
                value={statusFilter}
                onChange={(e) => {
                  const value = e.target.value as FeedbackStatusFilter;
                  setStatusFilter(value);
                  saveFeedbackStatusFilter(value);
                }}
                className="input text-sm py-1.5 px-2.5 w-auto min-w-[7rem] bg-theme-input-bg text-theme-input-text ring-theme-ring"
                aria-label="Filter feedback by status"
                data-testid="feedback-status-filter"
              >
                <option value="all">All ({countByStatus(feedback, "all")})</option>
                <option value="pending">Pending ({countByStatus(feedback, "pending")})</option>
                <option value="resolved">Resolved ({countByStatus(feedback, "resolved")})</option>
              </select>
            )}
          </div>

          {loading ? (
            <div className="text-center py-10 text-theme-muted">Loading feedback...</div>
          ) : feedback.length === 0 ? (
            <div className="text-center py-10 text-theme-muted text-sm">
              No feedback submitted yet. Test your app and report findings above.
            </div>
          ) : filteredFeedback.length === 0 ? (
            <div className="text-center py-10 text-theme-muted text-sm">
              {statusFilter === "all"
                ? "No feedback yet."
                : statusFilter === "pending"
                  ? "No pending feedback yet."
                  : "No resolved feedback yet."}
            </div>
          ) : (
            <div className="space-y-3">
              {feedbackTree.map((node) => (
                <FeedbackCard
                  key={node.item.id}
                  node={node}
                  depth={0}
                  projectId={projectId}
                  getTaskColumn={getTaskColumn}
                  getTaskPriority={getTaskPriority}
                  getTaskTitle={getTaskTitle}
                  onNavigateToBuildTask={onNavigateToBuildTask}
                  replyingToId={replyingToId}
                  onStartReply={setReplyingToId}
                  onCancelReply={() => setReplyingToId(null)}
                  onSubmitReply={handleSubmitReply}
                  onResolve={handleResolve}
                  onRemoveAfterAnimation={handleRemoveAfterAnimation}
                  collapsedIds={collapsedIds}
                  onToggleCollapse={handleToggleCollapse}
                  submitting={submitting}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
