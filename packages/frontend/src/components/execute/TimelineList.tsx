import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Task } from "@opensprint/shared";
import type { Plan } from "@opensprint/shared";
import { isAgentAssignee } from "@opensprint/shared";
import {
  sortTasksForTimeline,
  sortReadyTasksForDispatch,
  getTimelineSection,
  TIMELINE_SECTION,
} from "../../lib/executeTaskSort";
import { isTaskInPlanningPlan, isSelfImprovementTask } from "../../lib/executeTaskFilter";
import { getEpicTitleFromPlan } from "../../lib/planContentUtils";
import { PriorityIcon } from "../PriorityIcon";
import { AssigneeSelector } from "./AssigneeSelector";
import type { StatusFilter } from "../../lib/executeTaskFilter";
import { RelativeTimestampDisplay } from "../RelativeTimestampDisplay";
import { UptimeDisplay } from "../UptimeDisplay";
import { formatUntilTimestamp } from "../../lib/formatting";
import { PhaseScrollSectionHeader } from "../PhaseScrollSectionHeader";
import {
  PHASE_QUEUE_LIST_SECTION_BODY_CLASSNAME,
  PHASE_QUEUE_ROW_INNER_CLASSNAME,
  PHASE_QUEUE_ROW_META_MUTED_CLASSNAME,
  PHASE_QUEUE_ROW_TITLE_CLASSNAME,
  PHASE_QUEUE_ROW_VIRTUAL_OUTER_CLASSNAME,
  phaseQueueRowSurfaceClassName,
  phaseQueueRowPrimaryButtonClassName,
} from "../../lib/phaseQueueListView";

const ACTIVE_TASK_TICK_MS = 10_000;

/** Virtualize when task count exceeds this (matches BuildEpicCard; keeps small lists fully mounted for tests). */
export const TIMELINE_VIRTUALIZE_THRESHOLD = 10;
const ESTIMATED_SECTION_HEADER_HEIGHT = 44;
const ESTIMATED_TIMELINE_ROW_HEIGHT = 52;

type FlatTimelineItem =
  | { kind: "header"; sectionKey: string; label: string }
  | { kind: "row"; sectionKey: string; task: Task };

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
  waiting_to_merge: "Merge Queue",
  [TIMELINE_SECTION.active]: "In Progress",
  [TIMELINE_SECTION.queue]: "Up Next",
  [TIMELINE_SECTION.completed]: "Completed",
  blocked: "Failures",
  ready: "Ready",
  in_line: "Up Next",
  planning: "Planning",
};

function getMergeQueueDescription(task: Task): string {
  if (task.mergeGateState === "merging") {
    return "Merging now";
  }
  if (task.mergeGateState === "validating") {
    return "Running pre-merge checks";
  }
  if (task.mergeGateState === "blocked_on_baseline" || task.mergeWaitingOnMain) {
    return "Blocked on main baseline checks";
  }
  if (task.mergeGateState === "candidate_fix_needed") {
    return "Needs code fixes before merge";
  }
  if (task.mergeGateState === "environment_repair_needed") {
    return "Needs environment repair before merge";
  }
  return "Queued for merge";
}

function getMergeQueueRetrySuffix(task: Task): string | null {
  if (!task.mergePausedUntil) return null;
  const until = formatUntilTimestamp(task.mergePausedUntil);
  return until === "soon" ? "Retry eligible soon" : `Retry eligible ${until}`;
}

function getTimelineRightLabel(
  task: Task,
  epicName: string
): {
  text: string;
  title: string;
  testId: "task-row-epic-name" | "task-row-merge-description";
} | null {
  if (task.kanbanColumn === "waiting_to_merge") {
    const description = getMergeQueueDescription(task);
    const retrySuffix = getMergeQueueRetrySuffix(task);
    const text = retrySuffix ? `${description} • ${retrySuffix}` : description;
    return {
      text,
      title: text,
      testId: "task-row-merge-description",
    };
  }
  if (epicName) {
    return {
      text: epicName,
      title: epicName,
      testId: "task-row-epic-name",
    };
  }
  return null;
}

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
  asListItem = true,
  isSelected = false,
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
  /** False when row is inside a flat virtual list (section headers break ul/li grouping). */
  asListItem?: boolean;
  isSelected?: boolean;
}) {
  const isBlocked = task.kanbanColumn === "blocked";
  const isUnblocking = (unblockInflightByTaskId?.[task.id] ?? 0) > 0;
  const isDone = task.kanbanColumn === "done";
  const isInProgress = task.kanbanColumn === "in_progress" || task.kanbanColumn === "in_review";
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
  const rightLabel = getTimelineRightLabel(task, epicName);

  const rowOuterClass = `min-h-[52px] ${phaseQueueRowSurfaceClassName(isSelected)}${
    assigneeDropdownOpen ? " relative z-[1000]" : ""
  }`;
  const rowInner = (
    <div className={PHASE_QUEUE_ROW_INNER_CLASSNAME}>
      <button
        type="button"
        onClick={() => onTaskSelect(task.id)}
        className={phaseQueueRowPrimaryButtonClassName(isSelected)}
        aria-current={isSelected ? "true" : undefined}
        data-queue-row-selected={isSelected ? "true" : "false"}
      >
        <PriorityIcon priority={task.priority ?? 1} size="xs" />
        <span className={PHASE_QUEUE_ROW_TITLE_CLASSNAME} title={task.title}>
          {task.title}
        </span>
        {isSelfImprovementTask(task) && task.kanbanColumn !== "waiting_to_merge" && (
          <span
            className={`hidden md:inline ${PHASE_QUEUE_ROW_META_MUTED_CLASSNAME} font-medium`}
            title="Created by self-improvement"
            data-testid="task-badge-self-improvement"
          >
            Self-improvement
          </span>
        )}
        {rightLabel && (
          <span
            className={`${PHASE_QUEUE_ROW_META_MUTED_CLASSNAME} truncate max-w-[120px] min-[1000px]:max-w-[240px]`}
            title={rightLabel.title}
            data-testid={rightLabel.testId}
          >
            {rightLabel.text}
          </span>
        )}
        <span className={`${PHASE_QUEUE_ROW_META_MUTED_CLASSNAME} tabular-nums`}>
          {relativeTime}
        </span>
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
          <span className={PHASE_QUEUE_ROW_META_MUTED_CLASSNAME}>
            {task.assignee?.trim() ? task.assignee : null}
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
  );

  if (asListItem) {
    return (
      <li data-testid={`timeline-row-${task.id}`} className={rowOuterClass}>
        {rowInner}
      </li>
    );
  }

  return (
    <div data-testid={`timeline-row-${task.id}`} className={rowOuterClass}>
      {rowInner}
    </div>
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
    const ready = sortReadyTasksForDispatch(
      sorted.filter((t) => t.kanbanColumn === "ready" && notInPlanning(t))
    );
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

  const flatTimelineItems = useMemo((): FlatTimelineItem[] => {
    const items: FlatTimelineItem[] = [];
    for (const { key, tasks: sectionTasks } of sections) {
      if (sectionTasks.length === 0) continue;
      items.push({
        kind: "header",
        sectionKey: key,
        label: SECTION_LABELS[key] ?? key,
      });
      for (const task of sectionTasks) {
        items.push({ kind: "row", sectionKey: key, task });
      }
    }
    return items;
  }, [sections]);

  const useVirtual = tasks.length > TIMELINE_VIRTUALIZE_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: useVirtual ? flatTimelineItems.length : 0,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: (index) => {
      const row = flatTimelineItems[index];
      if (!row) return ESTIMATED_TIMELINE_ROW_HEIGHT;
      return row.kind === "header"
        ? ESTIMATED_SECTION_HEADER_HEIGHT
        : ESTIMATED_TIMELINE_ROW_HEIGHT;
    },
    overscan: 6,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const useVirtualFallback =
    useVirtual && virtualItems.length === 0 && flatTimelineItems.length > 0;
  const effectivelyVirtual = useVirtual && !useVirtualFallback;

  const rowRelativeTime = (task: Task) =>
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
    );

  const lastScrollKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!selectedTaskId) {
      lastScrollKeyRef.current = null;
      return;
    }
    const scrollKey = `${selectedTaskId}\0${effectivelyVirtual}`;
    if (lastScrollKeyRef.current === scrollKey) return;
    lastScrollKeyRef.current = scrollKey;

    if (effectivelyVirtual) {
      const idx = flatTimelineItems.findIndex(
        (it) => it.kind === "row" && it.task.id === selectedTaskId
      );
      if (idx >= 0) {
        virtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" });
      }
      return;
    }

    const container = scrollRef?.current;
    if (!container) return;
    const el = container.querySelector(
      `[data-testid="timeline-row-${selectedTaskId.replace(/[^\w-]/g, "\\$&")}"]`
    );
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [selectedTaskId, scrollRef, effectivelyVirtual, flatTimelineItems, virtualizer]);

  if (tasks.length === 0) {
    return null;
  }

  if (effectivelyVirtual) {
    return (
      <div
        data-testid="timeline-list"
        data-timeline-virtualized="true"
        className="w-full"
        role="list"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualItems.map((virtualRow) => {
            const item = flatTimelineItems[virtualRow.index];
            if (!item) return null;
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                role="listitem"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {item.kind === "header" ? (
                  <div data-testid={`timeline-section-${item.sectionKey}`}>
                    <PhaseScrollSectionHeader
                      variant="execute-timeline-virtual"
                      title={item.label}
                    />
                  </div>
                ) : (
                  <div className={PHASE_QUEUE_ROW_VIRTUAL_OUTER_CLASSNAME}>
                    <TimelineRow
                      task={item.task}
                      epicName={
                        item.task.epicId
                          ? (epicIdToTitle.get(item.task.epicId) ?? item.task.epicId)
                          : ""
                      }
                      relativeTime={rowRelativeTime(item.task)}
                      onTaskSelect={onTaskSelect}
                      onUnblock={item.task.kanbanColumn === "blocked" ? onUnblock : undefined}
                      unblockInflightByTaskId={unblockInflightByTaskId}
                      projectId={projectId}
                      teamMembers={teamMembers}
                      enableHumanTeammates={enableHumanTeammates}
                      asListItem={false}
                      isSelected={selectedTaskId === item.task.id}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="timeline-list" className="w-full">
      {sections.map(
        ({ key, tasks: sectionTasks }) =>
          sectionTasks.length > 0 && (
            <section key={key} data-testid={`timeline-section-${key}`}>
              <PhaseScrollSectionHeader
                variant="execute-timeline-sticky"
                title={SECTION_LABELS[key] ?? key}
              />
              <ul className={PHASE_QUEUE_LIST_SECTION_BODY_CLASSNAME}>
                {sectionTasks.map((task) => (
                  <TimelineRow
                    key={task.id}
                    task={task}
                    epicName={task.epicId ? (epicIdToTitle.get(task.epicId) ?? task.epicId) : ""}
                    relativeTime={rowRelativeTime(task)}
                    onTaskSelect={onTaskSelect}
                    onUnblock={task.kanbanColumn === "blocked" ? onUnblock : undefined}
                    unblockInflightByTaskId={unblockInflightByTaskId}
                    projectId={projectId}
                    teamMembers={teamMembers}
                    enableHumanTeammates={enableHumanTeammates}
                    isSelected={selectedTaskId === task.id}
                  />
                ))}
              </ul>
            </section>
          )
      )}
    </div>
  );
}
