import path from "path";
import type { AgentPhase, AgentConfig } from "@opensprint/shared";
import {
  AGENT_INACTIVITY_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  OPENSPRINT_PATHS,
} from "@opensprint/shared";
import { agentService } from "./agent.service.js";
import type { CodingAgentHandle } from "./agent.service.js";
import { heartbeatService } from "./heartbeat.service.js";
import { BranchManager } from "./branch-manager.js";
import { broadcastToProject, sendAgentOutputToProject } from "../websocket/index.js";
import { TimerRegistry } from "./timer-registry.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("agent-lifecycle");

/** Check whether a PID is still running */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Max total bytes retained in outputLog before oldest chunks are dropped */
const MAX_OUTPUT_LOG_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Mutable run state shared between the lifecycle manager and the orchestrator.
 * The orchestrator owns and reads/writes these fields; the lifecycle manager
 * updates them during agent execution.
 */
export interface AgentRunState {
  activeProcess: CodingAgentHandle | null;
  lastOutputTime: number;
  outputLog: string[];
  outputLogBytes: number;
  startedAt: string;
  exitHandled: boolean;
  killedDueToTimeout: boolean;
}

export interface AgentRunParams {
  projectId: string;
  taskId: string;
  phase: AgentPhase;
  wtPath: string;
  branchName: string;
  promptPath: string;
  agentConfig: AgentConfig;
  agentLabel: string;
  /** "coder" uses invokeCodingAgent; "reviewer" uses invokeReviewAgent */
  role: "coder" | "reviewer";
  /** Called when agent exits (normally or via dead-process detection) */
  onDone: (exitCode: number | null) => Promise<void>;
}

/**
 * Manages the common agent execution lifecycle: spawning, output streaming,
 * heartbeat writing, inactivity monitoring, dead-process detection, and
 * cleanup. Eliminates duplication between coding and review phases.
 */
export class AgentLifecycleManager {
  private branchManager = new BranchManager();

  /**
   * Spawn an agent process with full monitoring (heartbeat + inactivity).
   * The caller's onDone callback is invoked exactly once when the agent
   * finishes (either normally via onExit, or via dead-process detection).
   */
  run(params: AgentRunParams, runState: AgentRunState, timers: TimerRegistry): void {
    const {
      projectId,
      taskId,
      phase,
      wtPath,
      branchName,
      promptPath,
      agentConfig,
      agentLabel,
      role,
      onDone,
    } = params;

    runState.killedDueToTimeout = false;
    runState.exitHandled = false;
    runState.startedAt = new Date().toISOString();
    runState.outputLog = [];
    runState.outputLogBytes = 0;
    runState.lastOutputTime = Date.now();

    const outputLogPath = path.join(
      wtPath,
      OPENSPRINT_PATHS.active,
      taskId,
      OPENSPRINT_PATHS.agentOutputLog
    );

    broadcastToProject(projectId, {
      type: "agent.started",
      taskId,
      phase,
      branchName,
      startedAt: runState.startedAt,
    });

    const invoke =
      role === "coder"
        ? agentService.invokeCodingAgent.bind(agentService)
        : agentService.invokeReviewAgent.bind(agentService);

    runState.activeProcess = invoke(promptPath, agentConfig, {
      cwd: wtPath,
      agentRole: role === "coder" ? "coder" : "code reviewer",
      outputLogPath,
      tracking: {
        id: taskId,
        projectId,
        phase,
        role,
        label: agentLabel,
        branchName,
      },
      onOutput: (chunk: string) => {
        appendOutputLog(runState, chunk);
        runState.lastOutputTime = Date.now();
        sendAgentOutputToProject(projectId, taskId, chunk);
      },
      onExit: async (code: number | null) => {
        // #region agent log
        fetch("http://127.0.0.1:7244/ingest/7b4dbb83-aede-4af0-b5cc-f2f84134fedd", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "391add" },
          body: JSON.stringify({
            sessionId: "391add",
            location: "agent-lifecycle.ts:onExit:entry",
            message: "lifecycle onExit received",
            data: { taskId, phase, code, exitHandled: runState.exitHandled },
            timestamp: Date.now(),
            hypothesisId: "coding-review",
          }),
        }).catch(() => {});
        // #endregion
        if (runState.exitHandled) return;
        runState.exitHandled = true;
        runState.activeProcess = null;
        this.cleanupTimers(timers);
        await heartbeatService.deleteHeartbeat(wtPath, taskId);
        try {
          await onDone(code);
          // #region agent log
          fetch("http://127.0.0.1:7244/ingest/7b4dbb83-aede-4af0-b5cc-f2f84134fedd", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "391add" },
            body: JSON.stringify({
              sessionId: "391add",
              location: "agent-lifecycle.ts:onExit:onDoneReturned",
              message: "onDone callback returned",
              data: { taskId },
              timestamp: Date.now(),
              hypothesisId: "coding-review",
            }),
          }).catch(() => {});
          // #endregion
        } catch (err) {
          log.error("onDone failed", { taskId, exitCode: code, err });
        }
      },
    });

    this.startHeartbeat(runState, wtPath, taskId, timers);
    this.startInactivityMonitor(runState, wtPath, taskId, branchName, timers, onDone);
  }

  /**
   * Re-attach to an existing agent process after backend restart (GUPP recovery).
   * Does not spawn; sets runState.activeProcess to the handle and starts heartbeat + inactivity monitoring.
   * When the process exits (detected via isPidAlive), onDone is invoked.
   */
  resumeMonitoring(
    handle: CodingAgentHandle,
    params: AgentRunParams,
    runState: AgentRunState,
    timers: TimerRegistry
  ): void {
    const { wtPath, taskId, branchName, onDone } = params;
    runState.activeProcess = handle;
    runState.lastOutputTime = Date.now();
    runState.exitHandled = false;
    runState.killedDueToTimeout = false;

    this.startHeartbeat(runState, wtPath, taskId, timers);
    this.startInactivityMonitor(runState, wtPath, taskId, branchName, timers, onDone);
  }

  private startHeartbeat(
    runState: AgentRunState,
    wtPath: string,
    taskId: string,
    timers: TimerRegistry
  ): void {
    timers.setInterval(
      "heartbeat",
      () => {
        if (!runState.activeProcess) return;
        heartbeatService
          .writeHeartbeat(wtPath, taskId, {
            pid: runState.activeProcess.pid ?? 0,
            lastOutputTimestamp: runState.lastOutputTime,
            heartbeatTimestamp: Date.now(),
          })
          .catch(() => {});
      },
      HEARTBEAT_INTERVAL_MS
    );
  }

  private startInactivityMonitor(
    runState: AgentRunState,
    wtPath: string,
    taskId: string,
    branchName: string,
    timers: TimerRegistry,
    onDone: (exitCode: number | null) => Promise<void>
  ): void {
    timers.setInterval(
      "inactivity",
      () => {
        if (runState.exitHandled) return;
        const elapsed = Date.now() - runState.lastOutputTime;
        const proc = runState.activeProcess;
        const pidDead = proc && proc.pid !== null && !isPidAlive(proc.pid);

        if (pidDead) {
          if (runState.exitHandled) return;
          runState.exitHandled = true;
          log.warn("Agent process dead, recovering immediately", { taskId, pid: proc.pid });
          runState.activeProcess = null;
          this.cleanupTimers(timers);
          heartbeatService.deleteHeartbeat(wtPath, taskId).catch(() => {});
          this.branchManager
            .commitWip(wtPath, taskId)
            .then(() => onDone(null))
            .catch((err) => {
              log.error("Post-death handler failed", { taskId, err });
              return onDone(null);
            })
            .catch((err) => {
              log.error("onDone fallback also failed", { taskId, err });
            });
          return;
        }

        if (elapsed > AGENT_INACTIVITY_TIMEOUT_MS) {
          log.warn("Agent timeout", { taskId, elapsedMs: elapsed });
          if (runState.activeProcess) {
            runState.killedDueToTimeout = true;
            this.branchManager
              .commitWip(wtPath, taskId)
              .then(() => runState.activeProcess?.kill())
              .catch((err) => {
                log.error("Inactivity handler failed", { taskId, err });
                runState.activeProcess?.kill();
              });
          }
        }
      },
      30000
    );
  }

  private cleanupTimers(timers: TimerRegistry): void {
    timers.clear("heartbeat");
    timers.clear("inactivity");
  }
}

/** Append a chunk to outputLog, evicting oldest entries when the size cap is exceeded. */
function appendOutputLog(state: AgentRunState, chunk: string): void {
  state.outputLog.push(chunk);
  state.outputLogBytes += chunk.length;
  while (state.outputLogBytes > MAX_OUTPUT_LOG_BYTES && state.outputLog.length > 1) {
    const dropped = state.outputLog.shift()!;
    state.outputLogBytes -= dropped.length;
  }
}
