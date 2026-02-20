import { useState, useEffect, useMemo } from "react";
import type { Task } from "@opensprint/shared";
import { useAppDispatch, useAppSelector } from "../../store";
import { api } from "../../api/client";
import {
  fetchTaskDetail,
  fetchArchivedSessions,
  fetchLiveOutputBackfill,
  markTaskDone,
  unblockTask,
  setSelectedTaskId,
} from "../../store/slices/executeSlice";
import { wsSend } from "../../store/middleware/websocketMiddleware";
import { ResizableSidebar } from "../../components/layout/ResizableSidebar";
import { BuildEpicCard } from "../../components/kanban";
import { sortEpicTasksByStatus } from "../../lib/executeTaskSort";
import {
  filterTasksByStatusAndSearch,
  type StatusFilter as FilterStatusFilter,
} from "../../lib/executeTaskFilter";
import { getEpicTitleFromPlan } from "../../lib/planContentUtils";
import { useTaskFilter } from "../../hooks/useTaskFilter";
import { TaskDetailSidebar } from "../../components/execute/TaskDetailSidebar";

interface ExecutePhaseProps {
  projectId: string;
  onNavigateToPlan?: (planId: string) => void;
}

type StatusFilter = FilterStatusFilter;

export function ExecutePhase({ projectId, onNavigateToPlan }: ExecutePhaseProps) {
  const dispatch = useAppDispatch();
  const [taskIdToStartedAt, setTaskIdToStartedAt] = useState<Record<string, string>>({});
  const [artifactsSectionExpanded, setArtifactsSectionExpanded] = useState(true);
  const [descriptionSectionExpanded, setDescriptionSectionExpanded] = useState(true);
  const [sourceFeedbackExpanded, setSourceFeedbackExpanded] = useState<Record<string, boolean>>({});

  const {
    statusFilter,
    setStatusFilter,
    searchExpanded,
    searchInputValue,
    setSearchInputValue,
    searchQuery,
    searchInputRef,
    isSearchActive,
    handleSearchExpand,
    handleSearchClose,
    handleSearchKeyDown,
  } = useTaskFilter();

  const tasks = useAppSelector((s) => s.execute.tasks);
  const plans = useAppSelector((s) => s.plan.plans);
  const awaitingApproval = useAppSelector((s) => s.execute.awaitingApproval);
  const selectedTask = useAppSelector((s) => s.execute.selectedTaskId);
  const taskDetail = useAppSelector((s) => s.execute.taskDetail);
  const taskDetailLoading = useAppSelector((s) => s.execute.taskDetailLoading);
  const taskDetailError = useAppSelector((s) => s.execute.taskDetailError);
  const agentOutput = useAppSelector((s) => s.execute.agentOutput);
  const completionState = useAppSelector((s) => s.execute.completionState);
  const archivedSessions = useAppSelector((s) => s.execute.archivedSessions);
  const archivedLoading = useAppSelector((s) => s.execute.archivedLoading);
  const markDoneLoading = useAppSelector((s) => s.execute.markDoneLoading);
  const unblockLoading = useAppSelector((s) => s.execute.unblockLoading);
  const loading = useAppSelector((s) => s.execute.loading);
  const selectedTaskData = selectedTask ? tasks.find((t) => t.id === selectedTask) : null;
  const isDoneTask = selectedTaskData?.kanbanColumn === "done";
  const currentTaskId = useAppSelector((s) => s.execute.currentTaskId);
  const currentPhase = useAppSelector((s) => s.execute.currentPhase);
  const wsConnected = useAppSelector((s) => s.websocket?.connected ?? false);
  const isBlockedTask = selectedTaskData?.kanbanColumn === "blocked";

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const agents = await api.agents.active(projectId);
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const a of agents) {
          if (a.phase === "coding" || a.phase === "review") {
            map[a.id] = a.startedAt;
          }
        }
        setTaskIdToStartedAt(map);
      } catch {
        if (!cancelled) setTaskIdToStartedAt({});
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  useEffect(() => {
    if (selectedTask) {
      dispatch(fetchTaskDetail({ projectId, taskId: selectedTask }));
    }
  }, [projectId, selectedTask, dispatch]);

  useEffect(() => {
    if (selectedTask && isDoneTask) {
      dispatch(fetchArchivedSessions({ projectId, taskId: selectedTask }));
    }
  }, [projectId, selectedTask, isDoneTask, dispatch]);

  useEffect(() => {
    if (
      selectedTask &&
      !isDoneTask &&
      completionState &&
      agentOutput.length === 0 &&
      !archivedLoading
    ) {
      dispatch(fetchArchivedSessions({ projectId, taskId: selectedTask }));
    }
  }, [
    projectId,
    selectedTask,
    isDoneTask,
    completionState,
    agentOutput.length,
    archivedLoading,
    dispatch,
  ]);

  useEffect(() => {
    if (selectedTask && !isDoneTask && wsConnected) {
      dispatch(wsSend({ type: "agent.subscribe", taskId: selectedTask }));
      return () => {
        dispatch(wsSend({ type: "agent.unsubscribe", taskId: selectedTask }));
      };
    }
  }, [selectedTask, isDoneTask, wsConnected, dispatch]);

  useEffect(() => {
    if (selectedTask && !isDoneTask) {
      dispatch(fetchLiveOutputBackfill({ projectId, taskId: selectedTask }));
    }
  }, [projectId, selectedTask, isDoneTask, dispatch]);

  const handleMarkDone = async () => {
    if (!selectedTask || isDoneTask) return;
    dispatch(markTaskDone({ projectId, taskId: selectedTask }));
  };

  const handleUnblock = async () => {
    if (!selectedTask || !isBlockedTask) return;
    dispatch(unblockTask({ projectId, taskId: selectedTask }));
  };

  const implTasks = useMemo(
    () =>
      tasks.filter((t) => {
        const isEpic = t.type === "epic";
        const isGating = /\.0$/.test(t.id);
        return !isEpic && !isGating;
      }),
    [tasks],
  );

  const filteredTasks = useMemo(
    () => filterTasksByStatusAndSearch(implTasks, statusFilter, searchQuery),
    [implTasks, statusFilter, searchQuery]
  );

  const swimlanes = useMemo(() => {
    const epicIdToTitle = new Map<string, string>();
    plans.forEach((p) => {
      epicIdToTitle.set(p.metadata.beadEpicId, getEpicTitleFromPlan(p));
    });

    const byEpic = new Map<string | null, Task[]>();
    for (const t of filteredTasks) {
      const key = t.epicId ?? null;
      if (!byEpic.has(key)) byEpic.set(key, []);
      byEpic.get(key)!.push(t);
    }

    const allDone = (tasks: Task[]) =>
      tasks.length > 0 && tasks.every((t) => t.kanbanColumn === "done");
    const hideCompletedEpics = statusFilter === "all";

    const includeLane = (laneTasks: Task[]) =>
      laneTasks.length > 0 && (!hideCompletedEpics || !allDone(laneTasks));

    const result: { epicId: string; epicTitle: string; tasks: Task[] }[] = [];
    for (const plan of plans) {
      const epicId = plan.metadata.beadEpicId;
      if (!epicId) continue;
      const laneTasks = byEpic.get(epicId) ?? [];
      if (includeLane(laneTasks)) {
        result.push({
          epicId,
          epicTitle: epicIdToTitle.get(epicId) ?? epicId,
          tasks: sortEpicTasksByStatus(laneTasks),
        });
      }
    }
    const seenEpics = new Set(result.map((r) => r.epicId));
    for (const [epicId, laneTasks] of byEpic) {
      if (epicId && !seenEpics.has(epicId) && includeLane(laneTasks)) {
        result.push({
          epicId,
          epicTitle: epicId,
          tasks: sortEpicTasksByStatus(laneTasks),
        });
        seenEpics.add(epicId);
      }
    }
    const unassigned = byEpic.get(null) ?? [];
    if (includeLane(unassigned)) {
      result.push({ epicId: "", epicTitle: "Other", tasks: sortEpicTasksByStatus(unassigned) });
    }
    return result;
  }, [filteredTasks, plans, statusFilter]);

  const totalTasks = implTasks.length;
  const readyCount = implTasks.filter((t) => t.kanbanColumn === "ready").length;
  const blockedOnHumanCount = implTasks.filter((t) => t.kanbanColumn === "blocked").length;
  const inProgressCount = implTasks.filter((t) => t.kanbanColumn === "in_progress").length;
  const inReviewCount = implTasks.filter((t) => t.kanbanColumn === "in_review").length;
  const doneCount = implTasks.filter((t) => t.kanbanColumn === "done").length;

  const chipConfig: { label: string; filter: StatusFilter; count: number }[] = [
    { label: "All", filter: "all", count: totalTasks },
    { label: "Ready", filter: "ready", count: readyCount },
    { label: "In Progress", filter: "in_progress", count: inProgressCount },
    { label: "In Review", filter: "in_review", count: inReviewCount },
    { label: "Done", filter: "done", count: doneCount },
    ...(blockedOnHumanCount > 0
      ? [{ label: "⚠️ Blocked on Human", filter: "blocked" as StatusFilter, count: blockedOnHumanCount }]
      : []),
  ];

  return (
    <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        <div className="px-6 py-4 border-b border-theme-border bg-theme-surface shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
              {chipConfig.map(({ label, filter, count }) => {
                const isActive = statusFilter === filter;
                const isAll = filter === "all";
                const handleClick = () => {
                  setStatusFilter(isActive && !isAll ? "all" : filter);
                };
                return (
                  <button
                    key={filter}
                    type="button"
                    onClick={handleClick}
                    data-testid={`filter-chip-${filter}`}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-brand-600 text-white ring-2 ring-brand-500 ring-offset-2 ring-offset-theme-bg"
                        : "bg-theme-surface-muted text-theme-text hover:bg-theme-border-subtle"
                    }`}
                    aria-pressed={isActive}
                    aria-label={`${label} ${count}${isActive ? ", selected" : ""}`}
                  >
                    <span>{label}</span>
                    <span className={isActive ? "opacity-90" : "text-theme-muted"}>{count}</span>
                  </button>
                );
              })}
              {awaitingApproval && (
                <span className="ml-2 text-sm font-medium text-theme-warning-text">
                  Awaiting approval…
                </span>
              )}
            </div>
            <div className="flex items-center shrink-0">
              {searchExpanded ? (
                <div
                  className="flex items-center gap-1 overflow-hidden animate-fade-in"
                  data-testid="execute-search-expanded"
                >
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchInputValue}
                    onChange={(e) => setSearchInputValue(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Search tickets…"
                    className="w-48 sm:w-56 px-3 py-1.5 text-sm bg-theme-surface-muted border border-theme-border rounded-md text-theme-text placeholder:text-theme-muted focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                    aria-label="Search tickets"
                  />
                  <button
                    type="button"
                    onClick={handleSearchClose}
                    className="p-1.5 rounded-md text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle transition-colors"
                    aria-label="Close search"
                    data-testid="execute-search-close"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleSearchExpand}
                  className="p-1.5 rounded-md text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle transition-colors"
                  aria-label="Expand search"
                  data-testid="execute-search-expand"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-6">
          {loading ? (
            <div className="text-center py-10 text-theme-muted">Loading tasks...</div>
          ) : implTasks.length === 0 ? (
            <div className="text-center py-10 text-theme-muted">
              No tasks yet. Ship a Plan to start generating tasks.
            </div>
          ) : swimlanes.length === 0 ? (
            <div className="text-center py-10 text-theme-muted">
              {isSearchActive
                ? "No tasks match your search."
                : statusFilter === "all"
                  ? "All tasks completed."
                  : "No tasks match this filter."}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {swimlanes.map((lane) => (
                <BuildEpicCard
                  key={lane.epicId || "other"}
                  epicId={lane.epicId}
                  epicTitle={lane.epicTitle}
                  tasks={lane.tasks}
                  filteringActive={isSearchActive}
                  onTaskSelect={(taskId) => dispatch(setSelectedTaskId(taskId))}
                  onUnblock={(taskId) => dispatch(unblockTask({ projectId, taskId }))}
                  taskIdToStartedAt={taskIdToStartedAt}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedTask && (
        <>
          <button
            type="button"
            className="md:hidden fixed inset-0 bg-theme-overlay z-40 animate-fade-in"
            onClick={() => dispatch(setSelectedTaskId(null))}
            aria-label="Dismiss task detail"
          />
          <ResizableSidebar
            storageKey="execute"
            defaultWidth={420}
            responsive
            className="fixed md:static inset-y-0 right-0 z-50 md:border-l border-theme-border shadow-xl md:shadow-none animate-slide-in-right md:animate-none"
          >
            <TaskDetailSidebar
              projectId={projectId}
              selectedTask={selectedTask}
              selectedTaskData={selectedTaskData ?? null}
              taskDetail={taskDetail}
              taskDetailLoading={taskDetailLoading}
              taskDetailError={taskDetailError}
              agentOutput={agentOutput}
              completionState={completionState}
              archivedSessions={archivedSessions}
              archivedLoading={archivedLoading}
              markDoneLoading={markDoneLoading}
              unblockLoading={unblockLoading}
              taskIdToStartedAt={taskIdToStartedAt}
              plans={plans}
              tasks={tasks}
              currentTaskId={currentTaskId}
              currentPhase={currentPhase}
              wsConnected={wsConnected}
              isDoneTask={isDoneTask}
              isBlockedTask={isBlockedTask}
              sourceFeedbackExpanded={sourceFeedbackExpanded}
              setSourceFeedbackExpanded={setSourceFeedbackExpanded}
              descriptionSectionExpanded={descriptionSectionExpanded}
              setDescriptionSectionExpanded={setDescriptionSectionExpanded}
              artifactsSectionExpanded={artifactsSectionExpanded}
              setArtifactsSectionExpanded={setArtifactsSectionExpanded}
              onNavigateToPlan={onNavigateToPlan}
              onClose={() => dispatch(setSelectedTaskId(null))}
              onMarkDone={handleMarkDone}
              onUnblock={handleUnblock}
              onSelectTask={(taskId) => dispatch(setSelectedTaskId(taskId))}
            />
          </ResizableSidebar>
        </>
      )}
    </div>
  );
}
