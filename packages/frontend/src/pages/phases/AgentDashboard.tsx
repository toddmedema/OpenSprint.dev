import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import { useAppDispatch, useAppSelector } from "../../store";
import { setSelectedTaskId } from "../../store/slices/executeSlice";
import { wsSend } from "../../store/middleware/websocketMiddleware";
import { CloseButton } from "../../components/CloseButton";

interface AgentDashboardProps {
  projectId: string;
}

interface AgentInfo {
  taskId: string;
  phase: string;
  branchName: string;
  startedAt: string;
  outputLength: number;
}

export function AgentDashboard({ projectId }: AgentDashboardProps) {
  const dispatch = useAppDispatch();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [currentTask, setCurrentTask] = useState<string | null>(null);
  const [stats, setStats] = useState({ totalDone: 0, totalFailed: 0, queueDepth: 0 });

  const agentOutputMap = useAppSelector((s) => s.execute.agentOutput);
  const agentOutput = selectedAgent ? (agentOutputMap[selectedAgent] ?? []) : [];

  const loadStatus = useCallback(() => {
    api.execute.status(projectId).then((data: unknown) => {
      const status = data as {
        activeTasks?: Array<{ taskId: string; phase: string }>;
        totalDone: number;
        totalFailed: number;
        queueDepth: number;
      };
      const first = status?.activeTasks?.[0] ?? null;
      setCurrentTask(first?.taskId ?? null);
      setStats({
        totalDone: status?.totalDone ?? 0,
        totalFailed: status?.totalFailed ?? 0,
        queueDepth: status?.queueDepth ?? 0,
      });
    });
    api.agents.active(projectId).then((data) => {
      const list = Array.isArray(data) ? data : [];
      setAgents(
        list.map((a) => ({
          taskId: a.id,
          phase: a.phase,
          branchName: a.branchName ?? a.label,
          startedAt: a.startedAt,
          outputLength: 0,
        })),
      );
    }).catch(() => setAgents([]));
  }, [projectId]);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  // Sync selected agent with Redux so agent.output events are stored; subscribe/unsubscribe via wsSend
  useEffect(() => {
    if (selectedAgent) {
      dispatch(setSelectedTaskId(selectedAgent));
      dispatch(wsSend({ type: "agent.subscribe", taskId: selectedAgent }));
      return () => {
        dispatch(wsSend({ type: "agent.unsubscribe", taskId: selectedAgent }));
        dispatch(setSelectedTaskId(null));
      };
    } else {
      dispatch(setSelectedTaskId(null));
    }
  }, [selectedAgent, dispatch]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-theme-border bg-theme-surface">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-theme-text">Agent Dashboard</h2>
            <p className="text-sm text-theme-muted">Monitor and manage all agent instances</p>
          </div>
          <div className="flex items-center gap-4">
            <div
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                currentTask ? "bg-theme-success-bg text-theme-success-text" : "bg-theme-surface-muted text-theme-muted"
              }`}
            >
              {currentTask ? "Active" : "Idle"}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Stats & Agent List */}
        <div className="w-80 border-r border-theme-border flex flex-col">
          {/* Performance Metrics */}
          <div className="p-4 border-b border-theme-border">
            <h3 className="text-xs font-semibold text-theme-muted uppercase tracking-wide mb-3">Performance</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-2xl font-bold text-theme-success-text">{stats.totalDone}</div>
                <div className="text-xs text-theme-muted">Done</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-theme-error-text">{stats.totalFailed}</div>
                <div className="text-xs text-theme-muted">Failed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-theme-info-text">{stats.queueDepth}</div>
                <div className="text-xs text-theme-muted">Queue</div>
              </div>
            </div>
            {stats.totalDone + stats.totalFailed > 0 && (
              <div className="mt-3">
                <div className="text-xs text-theme-muted mb-1">Success Rate</div>
                <div className="w-full bg-theme-surface-muted rounded-full h-2">
                  <div
                    className="bg-theme-success-solid h-2 rounded-full"
                    style={{
                      width: `${Math.round((stats.totalDone / (stats.totalDone + stats.totalFailed)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Active Agents */}
          <div className="flex-1 overflow-y-auto p-4">
            <h3 className="text-xs font-semibold text-theme-muted uppercase tracking-wide mb-3">
              Active Agents ({agents.length})
            </h3>

            {agents.length === 0 ? (
              <div className="text-center py-8 text-theme-muted text-sm">No agents currently running</div>
            ) : (
              <div className="space-y-2">
                {agents.map((agent) => (
                  <button
                    key={agent.taskId}
                    onClick={() => setSelectedAgent(agent.taskId)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedAgent === agent.taskId
                        ? "border-theme-info-border bg-theme-info-bg"
                        : "border-theme-border hover:border-theme-ring"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-theme-text font-mono">{agent.taskId}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          agent.phase === "coding" ? "bg-theme-feedback-feature-bg text-theme-feedback-feature-text" : "bg-theme-warning-bg text-theme-warning-text"
                        }`}
                      >
                        {agent.phase}
                      </span>
                    </div>
                    <div className="text-xs text-theme-muted">Branch: {agent.branchName}</div>
                    <div className="text-xs text-theme-muted mt-1">
                      Started: {new Date(agent.startedAt).toLocaleTimeString()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Agent Output Stream (terminal-style) */}
        <div className="flex-1 flex flex-col bg-theme-code-bg">
          {selectedAgent ? (
            <>
              <div className="flex items-center justify-between px-4 py-2 border-b border-theme-border">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-theme-code-text">Agent Output</span>
                  <span className="text-xs text-theme-muted">{selectedAgent}</span>
                </div>
                <CloseButton
                  onClick={() => setSelectedAgent(null)}
                  ariaLabel="Close agent output"
                  className="p-1 rounded-md text-theme-muted hover:text-theme-text hover:bg-theme-surface transition-colors"
                />
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <pre className="text-xs font-mono text-theme-code-text whitespace-pre-wrap">
                  {agentOutput.length > 0 ? agentOutput.join("") : "Waiting for agent output..."}
                </pre>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-theme-muted text-sm">
              Select an agent to view its output stream
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
