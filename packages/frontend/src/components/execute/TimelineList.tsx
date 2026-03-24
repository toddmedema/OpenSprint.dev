import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Task } from "@opensprint/shared";
import type { Plan } from "@opensprint/shared";
import { isAgentAssignee } from "@opensprint/shared";
import {
  sortTasksForTimeline,
  getTimelineSection,
  TIMELINE_SECTION,
} from "../../lib/executeTaskSort";
import { isTaskInPlanningPlan, isSelfImprovementTask } from "../../lib/executeTaskFilter";
import { getEpicTitleFromPlan } from "../../lib/planContentUtils";
import { PriorityIcon } from "../PriorityIcon";
import { ComplexityIcon } from "../ComplexityIcon";
import { AssigneeSelector } from "./AssigneeSelector";
import type { StatusFilter } from "../../lib/executeTaskFilter";
import { RelativeTimestampDisplay } from "../RelativeTimestampDisplay";
import { UptimeDisplay } from "../UptimeDisplay";

const ACTIVE_TASK_TICK_MS = 10_000;

export interface TimelineListProps {
  tasks: Task[];
  plans: Plan[];
  onTaskSelect: (taskId: string) => void;
  onUnblock?: (taskId: string) => void;
  /** Per-task in-flight unblock count; Retry shows a spinner while count is positive. */
  unblockInflightByTaskId?: Readonly<Record<string, number>>;
  taskIdToStartedAt?: Record<string, string>;
  /** When "all", a Failures section is shown at top when blocked tasks exist. */
  statusFilter?: StatusFilter;
  /** Optional scroll container ref used for scroll-to-selected-task behavior. */
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  /** When provided, scrolls the selected task into view. */
  selectedTaskId?: string | null;
  /** Project ID for assignee updates. */
  projectId: string;
  /** Team members for assignee dropdown. */
  teamMembers: Array<{ id: string; name: string }>;
  /** When false, assignee is not editable (show as text only). */
  enableHumanTeammates?: boolean;
}

const SECTION_LABELS: Record<string, string> = {
  waiting_to_merge: "Waiting to Merge",
  [TIMELINE_SECTION.active]: "In Progress",
  [TIMELINE_SECTION.queue]: "Up Next",
  [TIMELINE_SECTION.completed]: "Completed",
  blocked: "Failures",
  ready: "Ready",
  in_line: "Up Next",
  planning: "Planning",
};

function TimelineRow({
  task,
  epicName,
  relativeTime,
  onTaskSelect,
  onUnblock,
  unblockInflightByTaskId,
  projectId,
  teamMembers,
  enableHumanTeammates,
}: {
  task: Task;
  epicName: string;
  relativeTime: ReactNode;
  onTaskSelect: (taskId: string) => void;
  onUnblock?: (taskId: string) => void;
  unblockInflightByTaskId?: Readonly<Record<string, number>>;
  projectId: string;
  teamMembers: Array<{ id: string; name: string }>;
  enableHumanTeammates?: boolean;
}) {
  const isBlocked = task.kanbanColumn === "blocked";
  const isUnblocking = (unblockInflightByTaskId?.[task.id] ?? 0) > 0;
  const isDone = task.kanbanColumn === "done";
  const isInProgress = task.kanbanColumn === "in_progress" || task.kanbanColumn === "in_review";
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);

  return (
    <li
      data-testid={`timeline-row-${task.id}`}
      className={assigneeDropdownOpen ? "relative z-[1000]" : undefined}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 group overflow-x-auto md:overflow-x-visible min-w-0">
        <button
          type="button"
          onClick={() => onTaskSelect(task.id)}
          className="flex-1 flex items-center gap-3 text-left hover:bg-theme-info-bg/50 transition-colors text-sm min-w-0"
        >
          <PriorityIcon priority={task.priority ?? 1} size="xs" />
          <ComplexityIcon complexity={task.complexity} size="xs" />
          <span className="flex-1 min-w-0 truncate font-medium text-theme-text" title={task.title}>
            {task.title}
          </span>
          {isSelfImprovementTask(task) && (
            <span
              className="hidden md:inline shrink-0 text-xs font-medium text-theme-muted"
              title="Created by self-improvement"
              data-testid="task-badge-self-improvement"
            >
              Self-improvement
            </span>
          )}
          {epicName && (
            <span
              className="shrink-0 text-xs text-theme-muted truncate max-w-[120px] min-[1000px]:max-w-[240px]"
              title={epicName}
              data-testid="task-row-epic-name"
            >
              {epicName}
            </span>
          )}
          <span className="text-xs text-theme-muted shrink-0 tabular-nums">{relativeTime}</span>
        </button>
        <span
          className="shrink-0 w-fit max-w-fit tabular-nums inline-flex items-center min-w-0"
          data-testid="task-row-assignee"
          role="presentation"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          tabIndex={-1}
        >
          {enableHumanTeammates ? (
            <AssigneeSelector
              projectId={projectId}
              taskId={task.id}
              currentAssignee={task.assignee ?? null}
              teamMembers={teamMembers}
              readOnly={isDone || isInProgress}
              isAgentAssignee={!!task.assignee && isAgentAssignee(task.assignee)}
              matchTaskNameTypography
              onOpenChange={setAssigneeDropdownOpen}
            />
          ) : (
            <span className="text-xs text-theme-muted">
              {task.assignee?.trim() ? task.assignee : "—"}
            </span>
          )}
        </span>
        {isBlocked && onUnblock && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUnblock(task.id);
            }}
            disabled={isUnblocking}
            aria-busy={isUnblocking}
            aria-label={isUnblocking ? "Retrying" : "Retry"}
            className="shrink-0 text-xs font-medium text-theme-error-text hover:bg-theme-error-bg px-2 py-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[3.25rem] min-h-[1.75rem] inline-flex items-center justify-center"
            data-testid={`timeline-retry-${task.id}`}
          >
            {isUnblocking ? (
              <span
                className="inline-block w-3.5 h-3.5 border-2 border-theme-border border-t-brand-500 rounded-full animate-spin"
                aria-hidden
              />
            ) : (
              "Retry"
            )}
          </button>
        )}
      </div>
    </li>
  );
}

export function TimelineList({
  tasks,
  plans,
  onTaskSelect,
  onUnblock,
  unblockInflightByTaskId = {},
  taskIdToStartedAt = {},
  statusFilter = "all",
  scrollRef,
  selectedTaskId,
  projectId,
  teamMembers,
  enableHumanTeammates = false,
}: TimelineListProps) {
  const epicIdToTitle = useMemo(() => {
    const m = new Map<string, string>();
    plans.forEach((p) => m.set(p.metadata.epicId, getEpicTitleFromPlan(p)));
    return m;
  }, [plans]);

  const sorted = useMemo(() => sortTasksForTimeline(tasks), [tasks]);
  const blockedTasks = useMemo(
    () =>
      statusFilter === "all"
        ? sorted.filter((t) => t.kanbanColumn === "blocked")
        : statusFilter === "blocked"
          ? sorted
          : [],
    [sorted, statusFilter]
  );
  const showBlockedSection = blockedTasks.length > 0;

  const bySection = useMemo(() => {
    const planningTasks = sorted.filter((t) => isTaskInPlanningPlan(t, plans));
    const planningIds = new Set(planningTasks.map((t) => t.id));
    const notInPlanning = (t: (typeof sorted)[number]) => !planningIds.has(t.id);

    const active = sorted.filter(
      (t) => getTimelineSection(t.kanbanColumn) === TIMELINE_SECTION.active
    );
    const waitingToMerge = sorted.filter(
      (t) => t.kanbanColumn === "waiting_to_merge" && notInPlanning(t)
    );
    const completed = sorted.filter(
      (t) => getTimelineSection(t.kanbanColumn) === TIMELINE_SECTION.completed
    );
    const ready = sorted.filter((t) => t.kanbanColumn === "ready" && notInPlanning(t));
    const inLine = sorted.filter(
      (t) => (t.kanbanColumn === "backlog" || t.kanbanColumn === "planning") && notInPlanning(t)
    );
    const blockedExcludingPlanning = blockedTasks.filter(notInPlanning);

    return {
      [TIMELINE_SECTION.active]: active,
      waiting_to_merge: waitingToMerge,
      [TIMELINE_SECTION.completed]: completed,
      blocked: blockedExcludingPlanning,
      ready,
      in_line: inLine,
      planning: planningTasks,
    };
  }, [sorted, blockedTasks, plans]);

  const sections = useMemo(
    () => [
      ...(showBlockedSection ? [{ key: "blocked" as const, tasks: bySection.blocked }] : []),
      { key: TIMELINE_SECTION.active, tasks: bySection[TIMELINE_SECTION.active] },
      { key: "waiting_to_merge" as const, tasks: bySection.waiting_to_merge },
      { key: "ready" as const, tasks: bySection.ready },
      { key: "in_line" as const, tasks: bySection.in_line },
      ...(bySection.planning.length > 0
        ? [{ key: "planning" as const, tasks: bySection.planning }]
        : []),
      { key: TIMELINE_SECTION.completed, tasks: bySection[TIMELINE_SECTION.completed] },
    ],
    [showBlockedSection, bySection]
  );

  const lastScrolledTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedTaskId) {
      lastScrolledTaskIdRef.current = null;
      return;
    }
    if (lastScrolledTaskIdRef.current === selectedTaskId) return;
    lastScrolledTaskIdRef.current = selectedTaskId;

    const container = scrollRef?.current;
    if (!container) return;
    const el = container.querySelector(
      `[data-testid="timeline-row-${selectedTaskId.replace(/[^\w-]/g, "\\$&")}"]`
    );
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [selectedTaskId, scrollRef]);

  if (tasks.length === 0) {
    return null;
  }

  return (
    <div data-testid="timeline-list">
      {sections.map(
        ({ key, tasks: sectionTasks }) =>
          sectionTasks.length > 0 && (
            <section key={key} data-testid={`timeline-section-${key}`}>
              <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-4 sm:pt-5 pb-[2px] mb-[7px] border-b border-theme-border-subtle bg-theme-bg">
                <h3 className="text-xs font-semibold text-theme-muted tracking-wide uppercase">
                  {SECTION_LABELS[key]}
                </h3>
              </div>
              <ul className="divide-y divide-theme-border-subtle">
                {sectionTasks.map((task) => (
                  <TimelineRow
                    key={task.id}
                    task={task}
                    epicName={task.epicId ? (epicIdToTitle.get(task.epicId) ?? task.epicId) : ""}
                    relativeTime={
                      (task.kanbanColumn === "in_progress" || task.kanbanColumn === "in_review") &&
                      taskIdToStartedAt[task.id] ? (
                        <UptimeDisplay
                          startedAt={taskIdToStartedAt[task.id]}
                          tickMs={ACTIVE_TASK_TICK_MS}
                          className="text-inherit tabular-nums"
                        />
                      ) : (
                        <RelativeTimestampDisplay
                          timestamp={task.updatedAt || task.createdAt || ""}
                          className="text-inherit tabular-nums"
                        />
                      )
                    }
                    onTaskSelect={onTaskSelect}
                    onUnblock={task.kanbanColumn === "blocked" ? onUnblock : undefined}
                    unblockInflightByTaskId={unblockInflightByTaskId}
                    projectId={projectId}
                    teamMembers={teamMembers}
                    enableHumanTeammates={enableHumanTeammates}
                  />
                ))}
              </ul>
            </section>
          )
      )}
    </div>
  );
}
