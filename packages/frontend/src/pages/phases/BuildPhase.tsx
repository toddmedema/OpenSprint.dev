import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import { useWebSocket } from "../../hooks/useWebSocket";
import type { ServerEvent, KanbanColumn } from "@opensprint/shared";
import { KANBAN_COLUMNS, PRIORITY_LABELS } from "@opensprint/shared";

interface BuildPhaseProps {
  projectId: string;
}

interface TaskCard {
  id: string;
  title: string;
  kanbanColumn: KanbanColumn;
  priority: number;
  assignee: string | null;
  epicId: string | null;
}

const columnLabels: Record<KanbanColumn, string> = {
  planning: "Planning",
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

const columnColors: Record<KanbanColumn, string> = {
  planning: "bg-gray-400",
  backlog: "bg-yellow-400",
  ready: "bg-blue-400",
  in_progress: "bg-purple-400",
  in_review: "bg-orange-400",
  done: "bg-green-400",
};

export function BuildPhase({ projectId }: BuildPhaseProps) {
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [orchestratorRunning, setOrchestratorRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [agentOutput, setAgentOutput] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleWsEvent = useCallback(
    (event: ServerEvent) => {
      switch (event.type) {
        case "task.updated":
          // Refresh tasks
          api.tasks.list(projectId).then((data) => setTasks(data as TaskCard[]));
          break;
        case "agent.output":
          if (event.taskId === selectedTask) {
            setAgentOutput((prev) => [...prev, event.chunk]);
          }
          break;
        case "build.status":
          setOrchestratorRunning(event.running);
          break;
      }
    },
    [projectId, selectedTask],
  );

  const { connected, subscribeToAgent, unsubscribeFromAgent } = useWebSocket({
    projectId,
    onEvent: handleWsEvent,
  });

  useEffect(() => {
    api.tasks
      .list(projectId)
      .then((data) => setTasks(data as TaskCard[]))
      .catch(console.error)
      .finally(() => setLoading(false));

    api.build.status(projectId).then((data: unknown) => {
      const status = data as { running: boolean };
      setOrchestratorRunning(status?.running ?? false);
    });
  }, [projectId]);

  // Subscribe to agent output when a task is selected
  useEffect(() => {
    if (selectedTask) {
      setAgentOutput([]);
      subscribeToAgent(selectedTask);
      return () => unsubscribeFromAgent(selectedTask);
    }
  }, [selectedTask, subscribeToAgent, unsubscribeFromAgent]);

  const handleStartBuild = async () => {
    setError(null);
    try {
      await api.build.start(projectId);
      setOrchestratorRunning(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start build";
      setError(msg);
    }
  };

  const handlePauseBuild = async () => {
    setError(null);
    try {
      await api.build.pause(projectId);
      setOrchestratorRunning(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to pause build";
      setError(msg);
    }
  };

  const tasksByColumn = KANBAN_COLUMNS.reduce(
    (acc, col) => {
      acc[col] = tasks.filter((t) => t.kanbanColumn === col);
      return acc;
    },
    {} as Record<KanbanColumn, TaskCard[]>,
  );

  const totalTasks = tasks.length;
  const doneTasks = tasksByColumn.done.length;
  const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <div className="flex flex-col h-full">
      {error && (
        <div className="mx-4 mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex justify-between items-center">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-500 hover:text-red-700 underline">
            Dismiss
          </button>
        </div>
      )}
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Build</h2>
            <p className="text-sm text-gray-500">
              {doneTasks}/{totalTasks} tasks completed
              {connected && <span className="ml-2 text-green-500">Connected</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {orchestratorRunning ? (
              <button onClick={handlePauseBuild} className="btn-secondary text-sm">
                Pause Build
              </button>
            ) : (
              <button onClick={handleStartBuild} className="btn-primary text-sm">
                Start Build
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className="bg-brand-600 h-2 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto p-6">
        {loading ? (
          <div className="text-center py-10 text-gray-400">Loading tasks...</div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-10 text-gray-500">No tasks yet. Ship a Plan to start generating tasks.</div>
        ) : (
          <div className="flex gap-4 min-w-max">
            {KANBAN_COLUMNS.map((col) => (
              <div key={col} className="kanban-column">
                {/* Column header */}
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${columnColors[col]}`} />
                  <h3 className="text-sm font-semibold text-gray-700">{columnLabels[col]}</h3>
                  <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
                    {tasksByColumn[col].length}
                  </span>
                </div>

                {/* Task cards */}
                <div className="space-y-2">
                  {tasksByColumn[col].map((task) => (
                    <div key={task.id} className="kanban-card" onClick={() => setSelectedTask(task.id)}>
                      <p className="text-sm font-medium text-gray-900 mb-2">{task.title}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400 font-mono">{task.id}</span>
                        <span className="text-xs text-gray-500">{PRIORITY_LABELS[task.priority] ?? "Medium"}</span>
                      </div>
                      {task.assignee && <div className="mt-2 text-xs text-brand-600">{task.assignee}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Agent Output Panel */}
      {selectedTask && (
        <div className="h-64 border-t border-gray-200 bg-gray-900 text-green-400 overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
            <span className="text-xs font-mono">Agent Output — {selectedTask}</span>
            <button onClick={() => setSelectedTask(null)} className="text-gray-500 hover:text-gray-300 text-xs">
              Close
            </button>
          </div>
          <pre className="p-4 text-xs font-mono whitespace-pre-wrap">
            {agentOutput.length > 0 ? agentOutput.join("") : "Waiting for agent output..."}
          </pre>
        </div>
      )}
    </div>
  );
}
