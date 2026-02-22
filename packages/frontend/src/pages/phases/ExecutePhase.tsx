import { useState, useEffect } from "react";
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
import { useTaskFilter } from "../../hooks/useTaskFilter";
import { useExecuteSwimlanes } from "../../hooks/useExecuteSwimlanes";
import { ExecuteFilterToolbar } from "../../components/execute/ExecuteFilterToolbar";
import { TaskDetailSidebar } from "../../components/execute/TaskDetailSidebar";

interface ExecutePhaseProps {
  projectId: string;
  onNavigateToPlan?: (planId: string) => void;
}

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
  const activeTasks = useAppSelector((s) => s.execute.activeTasks);
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

  const selectedAgentOutput = selectedTask ? (agentOutput[selectedTask] ?? []) : [];

  useEffect(() => {
    if (
      selectedTask &&
      !isDoneTask &&
      completionState &&
      selectedAgentOutput.length === 0 &&
      !archivedLoading
    ) {
      dispatch(fetchArchivedSessions({ projectId, taskId: selectedTask }));
    }
  }, [
    projectId,
    selectedTask,
    isDoneTask,
    completionState,
    selectedAgentOutput.length,
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

  const { implTasks, swimlanes, chipConfig } = useExecuteSwimlanes(
    tasks,
    plans,
    statusFilter,
    searchQuery
  );

  return (
    <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        <ExecuteFilterToolbar
          chipConfig={chipConfig}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          awaitingApproval={awaitingApproval}
          searchExpanded={searchExpanded}
          searchInputValue={searchInputValue}
          setSearchInputValue={setSearchInputValue}
          searchInputRef={searchInputRef}
          handleSearchExpand={handleSearchExpand}
          handleSearchClose={handleSearchClose}
          handleSearchKeyDown={handleSearchKeyDown}
        />

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
                  onViewPlan={
                    lane.planId && onNavigateToPlan
                      ? () => onNavigateToPlan(lane.planId!)
                      : undefined
                  }
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
              agentOutput={selectedAgentOutput}
              completionState={completionState}
              archivedSessions={archivedSessions}
              archivedLoading={archivedLoading}
              markDoneLoading={markDoneLoading}
              unblockLoading={unblockLoading}
              taskIdToStartedAt={taskIdToStartedAt}
              plans={plans}
              tasks={tasks}
              activeTasks={activeTasks}
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
