import { useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentSession, Plan, Task } from "@opensprint/shared";
import { PRIORITY_LABELS, AGENT_ROLE_LABELS } from "@opensprint/shared";
import type { ActiveTaskInfo } from "../../store/slices/executeSlice";
import { useAppDispatch } from "../../store";
import { updateTaskPriority } from "../../store/slices/executeSlice";
import { wsConnect } from "../../store/middleware/websocketMiddleware";
import { CloseButton } from "../CloseButton";
import { PriorityIcon } from "../PriorityIcon";
import { TaskStatusBadge, COLUMN_LABELS } from "../kanban";
import { formatUptime } from "../../lib/formatting";
import { getEpicTitleFromPlan } from "../../lib/planContentUtils";
import { ArchivedSessionView } from "./ArchivedSessionView";
import { SourceFeedbackSection } from "./SourceFeedbackSection";

export interface TaskDetailSidebarProps {
  projectId: string;
  selectedTask: string;
  selectedTaskData: Task | null;
  taskDetail: Task | null;
  taskDetailLoading: boolean;
  taskDetailError: string | null;
  agentOutput: string[];
  completionState: {
    status: string;
    testResults: { passed: number; failed: number; skipped: number; total: number } | null;
  } | null;
  archivedSessions: AgentSession[];
  archivedLoading: boolean;
  markDoneLoading: boolean;
  unblockLoading: boolean;
  taskIdToStartedAt: Record<string, string>;
  plans: Plan[];
  tasks: Task[];
  activeTasks: ActiveTaskInfo[];
  wsConnected: boolean;
  isDoneTask: boolean;
  isBlockedTask: boolean;
  sourceFeedbackExpanded: Record<string, boolean>;
  setSourceFeedbackExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  descriptionSectionExpanded: boolean;
  setDescriptionSectionExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  artifactsSectionExpanded: boolean;
  setArtifactsSectionExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  onNavigateToPlan?: (planId: string) => void;
  onClose: () => void;
  onMarkDone: () => void;
  onUnblock: () => void;
  onSelectTask: (taskId: string) => void;
}

const activeRoleLabel = (
  selectedTask: string,
  activeTasks: ActiveTaskInfo[],
) => {
  const active = activeTasks.find((a) => a.taskId === selectedTask);
  if (!active) return null;
  const phase = active.phase as "coding" | "review";
  return AGENT_ROLE_LABELS[phase === "coding" ? "coder" : "reviewer"] ?? null;
};

export function TaskDetailSidebar({
  projectId,
  selectedTask,
  selectedTaskData,
  taskDetail,
  taskDetailLoading,
  taskDetailError,
  agentOutput,
  completionState,
  archivedSessions,
  archivedLoading,
  markDoneLoading,
  unblockLoading,
  taskIdToStartedAt,
  plans,
  tasks,
  activeTasks,
  wsConnected,
  isDoneTask,
  isBlockedTask,
  sourceFeedbackExpanded,
  setSourceFeedbackExpanded,
  descriptionSectionExpanded,
  setDescriptionSectionExpanded,
  artifactsSectionExpanded,
  setArtifactsSectionExpanded,
  onNavigateToPlan,
  onClose,
  onMarkDone,
  onUnblock,
  onSelectTask,
}: TaskDetailSidebarProps) {
  const dispatch = useAppDispatch();
  const roleLabel = activeRoleLabel(selectedTask, activeTasks);
  const [priorityDropdownOpen, setPriorityDropdownOpen] = useState(false);
  const priorityDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!priorityDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        priorityDropdownRef.current &&
        !priorityDropdownRef.current.contains(e.target as Node)
      ) {
        setPriorityDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [priorityDropdownOpen]);

  const handlePrioritySelect = (priority: number) => {
    const task = taskDetail ?? selectedTaskData;
    if (!task || !selectedTask || task.priority === priority) return;
    const previousPriority = task.priority ?? 1;
    dispatch(
      updateTaskPriority({
        projectId,
        taskId: selectedTask,
        priority,
        previousPriority,
      })
    );
    setPriorityDropdownOpen(false);
  };

  return (
    <>
      <div className="flex items-center justify-between p-4 border-b border-theme-border shrink-0">
        <div className="min-w-0 flex-1 pr-2">
          {/* Task title shown immediately from cached list data while detail loads (feedback t586o4) */}
          <h3
            className="font-semibold text-theme-text truncate block"
            data-testid="task-detail-title"
          >
            {selectedTaskData?.title ?? taskDetail?.title ?? selectedTask ?? ""}
          </h3>
          {(selectedTaskData?.epicId ?? taskDetail?.epicId) && (() => {
            const epicId = selectedTaskData?.epicId ?? taskDetail?.epicId;
            const plan = plans.find((p) => p.metadata.beadEpicId === epicId);
            if (!plan || !onNavigateToPlan) return null;
            const planTitle = getEpicTitleFromPlan(plan);
            return (
              <button
                type="button"
                onClick={() => onNavigateToPlan(plan.metadata.planId)}
                className="mt-1 text-xs text-brand-600 hover:text-brand-700 hover:underline truncate block text-left"
                title={`View plan: ${planTitle}`}
              >
                View plan: {planTitle}
              </button>
            );
          })()}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isBlockedTask && (
            <button
              type="button"
              onClick={onUnblock}
              disabled={unblockLoading}
              className="text-xs py-1.5 px-3 font-medium text-theme-error-text hover:bg-theme-error-bg rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="sidebar-unblock-btn"
            >
              {unblockLoading ? "Unblocking…" : "Unblock"}
            </button>
          )}
          {!isDoneTask && !isBlockedTask && (
            <button
              type="button"
              onClick={onMarkDone}
              disabled={markDoneLoading}
              className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {markDoneLoading ? "Marking…" : "Mark done"}
            </button>
          )}
          <CloseButton onClick={onClose} ariaLabel="Close task detail" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-4 border-b border-theme-border">
          {(selectedTaskData ?? taskDetail) && (
            <>
              {/* Row 1: Priority + State inline directly below header */}
              <div
                className="flex flex-wrap items-center gap-2 mb-3 text-xs text-theme-muted"
                data-testid="task-detail-priority-state-row"
              >
                {((selectedTaskData ?? taskDetail)?.status === "closed" || !taskDetail) ? (
                  <span
                    className="inline-flex items-center gap-1.5 text-theme-muted/80 cursor-default"
                    data-testid="priority-read-only"
                    aria-label={`Priority: ${PRIORITY_LABELS[(taskDetail ?? selectedTaskData)!.priority ?? 1] ?? "Medium"}`}
                  >
                    <PriorityIcon priority={(taskDetail ?? selectedTaskData)!.priority ?? 1} size="sm" />
                    {PRIORITY_LABELS[(taskDetail ?? selectedTaskData)!.priority ?? 1] ?? "Medium"}
                  </span>
                ) : (
                  <div ref={priorityDropdownRef} className="relative inline-block">
                    <button
                      type="button"
                      onClick={() => setPriorityDropdownOpen((o) => !o)}
                      className="inline-flex items-center gap-2 rounded px-2 py-1 text-theme-muted hover:bg-theme-border-subtle/50 hover:text-theme-text transition-colors cursor-pointer"
                      aria-haspopup="listbox"
                      aria-expanded={priorityDropdownOpen}
                      aria-label={`Priority: ${PRIORITY_LABELS[(taskDetail ?? selectedTaskData)!.priority ?? 1] ?? "Medium"}. Click to change`}
                      data-testid="priority-dropdown-trigger"
                    >
                      <PriorityIcon priority={(taskDetail ?? selectedTaskData)!.priority ?? 1} size="sm" />
                      <span>{PRIORITY_LABELS[(taskDetail ?? selectedTaskData)!.priority ?? 1] ?? "Medium"}</span>
                      <span className="text-[10px] opacity-70">{priorityDropdownOpen ? "▲" : "▼"}</span>
                    </button>
                    {priorityDropdownOpen && (
                      <ul
                        role="listbox"
                        className="absolute left-0 top-full mt-1 z-50 min-w-[140px] rounded-lg border border-theme-border bg-theme-surface shadow-lg py-1"
                        data-testid="priority-dropdown"
                      >
                        {([0, 1, 2, 3, 4] as const).map((p) => (
                          <li key={p} role="option">
                            <button
                              type="button"
                              onClick={() => handlePrioritySelect(p)}
                              className={`w-full flex items-center gap-2 text-left px-3 py-2 text-xs hover:bg-theme-border-subtle/50 transition-colors ${
                                (taskDetail.priority ?? 1) === p
                                  ? "text-brand-600 font-medium"
                                  : "text-theme-text"
                              }`}
                              data-testid={`priority-option-${p}`}
                            >
                              <PriorityIcon priority={p} size="sm" />
                              {p}: {PRIORITY_LABELS[p]}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <TaskStatusBadge
                  column={(taskDetail ?? selectedTaskData)!.kanbanColumn}
                  size="xs"
                  title={COLUMN_LABELS[(taskDetail ?? selectedTaskData)!.kanbanColumn]}
                />
                <span>{COLUMN_LABELS[(taskDetail ?? selectedTaskData)!.kanbanColumn]}</span>
                {((taskDetail ?? selectedTaskData)!.assignee) && (
                  <>
                    <span>·</span>
                    <span className="text-brand-600">{((taskDetail ?? selectedTaskData)!).assignee}</span>
                  </>
                )}
              </div>
              {/* Row 2: Active callout - agent left, elapsed time right */}
              {roleLabel && (
                <div
                  className="mb-3 px-3 py-1.5 rounded-md bg-theme-warning-bg border border-theme-warning-border text-xs font-medium text-theme-warning-text flex items-center justify-between gap-3 min-w-0"
                  data-testid="task-detail-active-callout"
                >
                  <span className="truncate">Active: {roleLabel}</span>
                  {selectedTask && taskIdToStartedAt[selectedTask] ? (
                    <span className="tabular-nums shrink-0">{formatUptime(taskIdToStartedAt[selectedTask])}</span>
                  ) : null}
                </div>
              )}
            </>
          )}
          {taskDetailError ? (
            <div
              className="rounded-lg border border-theme-error-border bg-theme-error-bg p-4 text-sm text-theme-error-text"
              data-testid="task-detail-error"
            >
              {taskDetailError}
            </div>
          ) : taskDetailLoading ? (
            <div className="space-y-3" data-testid="task-detail-loading">
              <div className="h-4 w-3/4 bg-theme-surface-muted rounded animate-pulse" />
              <div className="h-3 w-full bg-theme-surface-muted rounded animate-pulse" />
              <div className="h-3 w-2/3 bg-theme-surface-muted rounded animate-pulse" />
              <div className="h-24 w-full bg-theme-surface-muted rounded animate-pulse" />
            </div>
          ) : taskDetail ? (
            null
          ) : (
            <div className="text-sm text-theme-muted" data-testid="task-detail-empty">
              Could not load task details.
            </div>
          )}
        </div>

        {taskDetail?.sourceFeedbackId && (
          <SourceFeedbackSection
            projectId={projectId}
            feedbackId={taskDetail.sourceFeedbackId}
            plans={plans}
            expanded={sourceFeedbackExpanded[taskDetail.sourceFeedbackId] ?? true}
            onToggle={() =>
              setSourceFeedbackExpanded((prev) => ({
                ...prev,
                [taskDetail.sourceFeedbackId!]: !(prev[taskDetail.sourceFeedbackId!] ?? true),
              }))
            }
          />
        )}

        {taskDetail && (() => {
          const desc = taskDetail.description ?? "";
          const isOnlyFeedbackId = /^Feedback ID:\s*.+$/.test(desc.trim());
          const displayDesc = taskDetail.sourceFeedbackId && isOnlyFeedbackId ? "" : desc;
          const hasDeps =
            (taskDetail.dependencies ?? []).filter((d) => d.targetId && d.type !== "discovered-from").length > 0;
          if (!displayDesc && !hasDeps) return null;
          return (
            <div className="p-4 border-b border-theme-border">
              {displayDesc ? (
                <div className="border-b border-theme-border">
                  <button
                    type="button"
                    onClick={() => setDescriptionSectionExpanded((prev) => !prev)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-theme-border-subtle/50 transition-colors"
                    aria-expanded={descriptionSectionExpanded}
                    aria-controls="description-content"
                    aria-label={descriptionSectionExpanded ? "Collapse Description" : "Expand Description"}
                    id="description-header"
                  >
                    <h4 className="text-xs font-medium text-theme-muted uppercase tracking-wide">
                      Description
                    </h4>
                    <span className="text-theme-muted text-xs">
                      {descriptionSectionExpanded ? "▼" : "▶"}
                    </span>
                  </button>
                  {descriptionSectionExpanded && (
                    <div
                      id="description-content"
                      role="region"
                      aria-labelledby="description-header"
                      className="px-4 pb-4"
                    >
                      <div
                        className="prose-task-description prose-execute-task"
                        data-testid="task-description-markdown"
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayDesc}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
              {hasDeps && (
                <div className={displayDesc ? "pt-0" : ""}>
                  <div className="text-xs">
                    <span className="text-theme-muted">Depends on:</span>
                    <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-1.5">
                      {taskDetail.dependencies
                        .filter((d) => d.targetId && d.type !== "discovered-from")
                        .map((d) => {
                          const depTask = tasks.find((t) => t.id === d.targetId);
                          const label = depTask?.title ?? d.targetId;
                          const col = depTask?.kanbanColumn ?? "backlog";
                          return (
                            <button
                              key={d.targetId}
                              type="button"
                              onClick={() => onSelectTask(d.targetId!)}
                              className="inline-flex items-center gap-1.5 text-left hover:underline text-brand-600 hover:text-brand-500 transition-colors"
                            >
                              <TaskStatusBadge column={col} size="xs" title={COLUMN_LABELS[col]} />
                              <span className="truncate max-w-[200px]" title={label}>
                                {label}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        <div className="border-b border-theme-border">
          <button
            type="button"
            onClick={() => setArtifactsSectionExpanded(!artifactsSectionExpanded)}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-theme-border-subtle/50 transition-colors"
            aria-expanded={artifactsSectionExpanded}
            aria-controls="artifacts-content"
            aria-label={
              artifactsSectionExpanded
                ? `Collapse ${isDoneTask ? "Done Work Artifacts" : "Live agent output"}`
                : `Expand ${isDoneTask ? "Done Work Artifacts" : "Live agent output"}`
            }
            id="artifacts-header"
          >
            <h4 className="text-xs font-medium text-theme-muted uppercase tracking-wide">
              {isDoneTask ? "Done Work Artifacts" : "Live agent output"}
            </h4>
            <span className="text-theme-muted text-xs">
              {artifactsSectionExpanded ? "▼" : "▶"}
            </span>
          </button>
          {artifactsSectionExpanded && (
            <div
              id="artifacts-content"
              role="region"
              aria-labelledby="artifacts-header"
              className="p-4 pt-0"
            >
              <div className="bg-theme-code-bg rounded-lg border border-theme-border overflow-hidden min-h-[200px] max-h-[400px] flex flex-col">
                {taskDetailLoading ? (
                  <div className="p-4 space-y-2" data-testid="artifacts-loading">
                    <div className="h-3 w-full bg-theme-surface-muted rounded animate-pulse" />
                    <div className="h-3 w-4/5 bg-theme-surface-muted rounded animate-pulse" />
                    <div className="h-20 w-full bg-theme-surface-muted rounded animate-pulse mt-4" />
                  </div>
                ) : isDoneTask ? (
                  archivedLoading ? (
                    <div className="p-4 text-theme-muted text-sm">Loading archived sessions...</div>
                  ) : archivedSessions.length === 0 ? (
                    <div className="p-4 text-theme-muted text-sm">No archived sessions for this task.</div>
                  ) : (
                    <ArchivedSessionView sessions={archivedSessions} />
                  )
                ) : (
                  <div className="flex flex-col min-h-0 flex-1">
                    {!wsConnected ? (
                      <div className="p-4 flex flex-col gap-3" data-testid="live-output-connecting">
                        <div className="text-sm text-theme-muted flex items-center gap-2">
                          <span
                            className="inline-block w-4 h-4 border-2 border-theme-border border-t-brand-500 rounded-full animate-spin"
                            aria-hidden
                          />
                          Connecting to live output…
                        </div>
                        <p className="text-xs text-theme-muted">
                          If the connection fails, you can retry.
                        </p>
                        <button
                          type="button"
                          onClick={() => dispatch(wsConnect({ projectId }))}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline self-start"
                          data-testid="live-output-retry"
                        >
                          Retry connection
                        </button>
                      </div>
                    ) : (
                      <pre
                        className="p-4 text-xs font-mono whitespace-pre-wrap text-theme-success-muted min-h-[120px] overflow-y-auto flex-1 min-h-0"
                        data-testid="live-agent-output"
                      >
                        {agentOutput.length > 0
                          ? agentOutput.join("")
                          : completionState && archivedSessions.length > 0
                            ? (archivedSessions[archivedSessions.length - 1]?.outputLog ??
                              "Waiting for agent output...")
                            : "Waiting for agent output..."}
                      </pre>
                    )}
                    {completionState && (
                      <div className="px-4 pb-4 border-t border-theme-border pt-3 mt-0">
                        <div
                          className={`text-sm font-medium ${
                            completionState.status === "approved"
                              ? "text-theme-success-muted"
                              : "text-theme-warning-solid"
                          }`}
                        >
                          Agent done: {completionState.status}
                        </div>
                        {completionState.testResults && completionState.testResults.total > 0 && (
                          <div className="text-xs text-theme-muted mt-1">
                            {completionState.testResults.passed} passed
                            {completionState.testResults.failed > 0
                              ? `, ${completionState.testResults.failed} failed`
                              : ""}
                            {completionState.testResults.skipped > 0 &&
                              `, ${completionState.testResults.skipped} skipped`}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
