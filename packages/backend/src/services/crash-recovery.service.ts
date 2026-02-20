import path from "path";
import { open as fsOpen, stat as fsStat, readdir, readFile } from "fs/promises";
import type {
  AgentPhase,
  CodingAgentResult,
  ProjectSettings,
  TestResults,
} from "@opensprint/shared";
import {
  AGENT_INACTIVITY_TIMEOUT_MS,
  OPENSPRINT_PATHS,
  resolveTestCommand,
  DEFAULT_REVIEW_MODE,
} from "@opensprint/shared";
import type { BeadsIssue } from "./beads.service.js";
import { activeAgentsService } from "./active-agents.service.js";
import { heartbeatService } from "./heartbeat.service.js";
import { broadcastToProject, sendAgentOutputToProject } from "../websocket/index.js";
import { normalizeCodingStatus } from "./result-normalizers.js";
import { eventLogService } from "./event-log.service.js";
import type { TaskAssignment } from "./orchestrator.service.js";

const RECOVERY_POLL_MS = 30_000;

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── State Persistence Types (same as orchestrator) ───

export interface PersistedOrchestratorState {
  projectId: string;
  currentTaskId: string | null;
  currentTaskTitle?: string | null;
  currentPhase: AgentPhase | null;
  branchName: string | null;
  worktreePath?: string | null;
  agentPid: number | null;
  attempt: number;
  startedAt: string | null;
  lastTransition: string;
  lastOutputTimestamp: number | null;
  queueDepth: number;
  totalDone: number;
  totalFailed: number;
}

/** Interface for the services the crash recovery needs from the orchestrator */
export interface CrashRecoveryDeps {
  beads: {
    show(repoPath: string, taskId: string): Promise<BeadsIssue>;
    update(
      repoPath: string,
      taskId: string,
      opts: Record<string, unknown>
    ): Promise<BeadsIssue | void>;
    comment(repoPath: string, taskId: string, text: string): Promise<void>;
  };
  projectService: {
    getSettings(projectId: string): Promise<ProjectSettings>;
  };
  branchManager: {
    getCommitCountAhead(repoPath: string, branchName: string): Promise<number>;
    captureBranchDiff(repoPath: string, branchName: string): Promise<string>;
    removeTaskWorktree(repoPath: string, taskId: string): Promise<void>;
    deleteBranch(repoPath: string, branchName: string): Promise<void>;
    getChangedFiles(repoPath: string, branchName: string): Promise<string[]>;
    commitWip(wtPath: string, taskId: string): Promise<boolean | void>;
  };
  sessionManager: {
    readResult(wtPath: string, taskId: string): Promise<unknown>;
  };
  testRunner: {
    runScopedTests(
      wtPath: string,
      changedFiles: string[],
      testCommand?: string
    ): Promise<TestResults>;
  };
}

/** Callbacks the crash recovery invokes on the orchestrator */
export interface CrashRecoveryCallbacks {
  clearPersistedState(repoPath: string): Promise<void>;
  persistState(projectId: string, repoPath: string): Promise<void>;
  handleCodingDone(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    branchName: string,
    exitCode: number | null
  ): Promise<void>;
  handleReviewDone(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    branchName: string,
    exitCode: number | null
  ): Promise<void>;
  handleTaskFailure(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    branchName: string,
    reason: string,
    testResults: TestResults | null,
    failureType: string
  ): Promise<void>;
  executeReviewPhase(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    branchName: string
  ): Promise<void>;
  performMergeAndDone(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    branchName: string
  ): Promise<void>;
}

/** Mutable state the crash recovery reads/writes on the orchestrator state */
export interface CrashRecoveryState {
  status: {
    currentTask: string | null;
    currentPhase: AgentPhase | null;
    queueDepth: number;
    totalDone: number;
    totalFailed: number;
  };
  loopActive: boolean;
  agent: {
    startedAt: string;
    lastOutputTime: number;
    killedDueToTimeout: boolean;
  };
  attempt: number;
  activeBranchName: string | null;
  activeTaskTitle: string | null;
  activeWorktreePath: string | null;
  phaseResult: {
    codingDiff: string;
    codingSummary: string;
    testResults: TestResults | null;
    testOutput: string;
  };
  timers: {
    setInterval(name: string, fn: () => void, ms: number): void;
    clear(name: string): void;
  };
}

/**
 * Handles crash recovery for the orchestrator.
 * Extracted to reduce the orchestrator's complexity while keeping
 * the same three-scenario approach (no task, PID alive, PID dead).
 */
export class CrashRecoveryService {
  /**
   * Attempt to recover from a crash based on persisted state.
   * Three scenarios:
   *   1. No active task → normal start
   *   2. Active task, agent PID alive → monitor until exit, then handle result
   *   3. Active task, agent PID dead → revert branch, comment, requeue
   */
  async recoverFromPersistedState(
    projectId: string,
    repoPath: string,
    persisted: PersistedOrchestratorState,
    state: CrashRecoveryState,
    deps: CrashRecoveryDeps,
    callbacks: CrashRecoveryCallbacks
  ): Promise<void> {
    state.status.totalDone =
      persisted.totalDone ?? (persisted as { totalCompleted?: number }).totalCompleted ?? 0;
    state.status.totalFailed = persisted.totalFailed;

    if (!persisted.currentTaskId || !persisted.branchName) {
      console.log("[orchestrator] Recovery: no active task in persisted state, starting fresh");
      await callbacks.clearPersistedState(repoPath);
      return;
    }

    const taskId = persisted.currentTaskId;
    const branchName = persisted.branchName;
    const pid = persisted.agentPid;

    console.log("[orchestrator] Recovery: found persisted active task", {
      projectId,
      taskId,
      phase: persisted.currentPhase,
      pid,
    });

    // Scenario 2: PID is still alive
    if (pid && isPidAlive(pid)) {
      await this.handleAlivePid(
        projectId,
        repoPath,
        persisted,
        taskId,
        branchName,
        pid,
        state,
        deps,
        callbacks
      );
      return;
    }

    // Scenario 3: PID is dead (or missing)
    await this.performCrashRecovery(
      projectId,
      repoPath,
      taskId,
      branchName,
      persisted.worktreePath,
      persisted,
      state,
      deps,
      callbacks
    );
  }

  private async handleAlivePid(
    projectId: string,
    repoPath: string,
    persisted: PersistedOrchestratorState,
    taskId: string,
    branchName: string,
    pid: number,
    state: CrashRecoveryState,
    deps: CrashRecoveryDeps,
    callbacks: CrashRecoveryCallbacks
  ): Promise<void> {
    const wtPath = persisted.worktreePath;
    let lastOutput = Date.now();
    let lastOutputSource = "now (fallback)";

    if (wtPath) {
      const hb = await heartbeatService.readHeartbeat(wtPath, taskId);
      if (hb && hb.lastOutputTimestamp > 0) {
        lastOutput = hb.lastOutputTimestamp;
        lastOutputSource = "heartbeat file";
      } else if (persisted.lastOutputTimestamp && persisted.lastOutputTimestamp > 0) {
        lastOutput = persisted.lastOutputTimestamp;
        lastOutputSource = "persisted state";
      }
    } else if (persisted.lastOutputTimestamp && persisted.lastOutputTimestamp > 0) {
      lastOutput = persisted.lastOutputTimestamp;
      lastOutputSource = "persisted state";
    }

    const inactiveMs = Date.now() - lastOutput;
    console.log(`[orchestrator] Recovery: agent PID ${pid} still alive`, {
      lastOutputSource,
      inactiveForSec: Math.round(inactiveMs / 1000),
      timeoutSec: Math.round(AGENT_INACTIVITY_TIMEOUT_MS / 1000),
    });

    if (inactiveMs > AGENT_INACTIVITY_TIMEOUT_MS) {
      console.warn(
        `[orchestrator] Recovery: agent PID ${pid} exceeded inactivity timeout ` +
          `(${Math.round(inactiveMs / 1000)}s > ${Math.round(AGENT_INACTIVITY_TIMEOUT_MS / 1000)}s), killing`
      );
      this.killPidGracefully(pid);

      await this.performCrashRecovery(
        projectId,
        repoPath,
        taskId,
        branchName,
        persisted.worktreePath,
        persisted,
        state,
        deps,
        callbacks
      );
      return;
    }

    console.log(`[orchestrator] Recovery: resuming monitoring for PID ${pid}`);

    state.status.currentTask = taskId;
    state.status.currentPhase = persisted.currentPhase;
    state.activeBranchName = branchName;
    state.activeTaskTitle = persisted.currentTaskTitle ?? null;
    state.activeWorktreePath = persisted.worktreePath ?? null;
    state.attempt = persisted.attempt;
    state.agent.startedAt = persisted.startedAt ?? new Date().toISOString();
    state.agent.lastOutputTime = lastOutput;
    state.loopActive = true;

    activeAgentsService.register(
      taskId,
      projectId,
      persisted.currentPhase ?? "coding",
      persisted.currentPhase === "review" ? "reviewer" : "coder",
      persisted.currentTaskTitle ?? taskId,
      state.agent.startedAt,
      branchName
    );

    // Stream existing agent output from the log file so the frontend can
    // display what the agent produced before the backend restarted.
    const outputLogPath = wtPath
      ? path.join(wtPath, OPENSPRINT_PATHS.active, taskId, OPENSPRINT_PATHS.agentOutputLog)
      : null;
    let outputReadOffset = 0;

    if (outputLogPath) {
      try {
        const initialBytes = await this.readOutputLogTail(outputLogPath, 1024 * 1024);
        if (initialBytes.data.length > 0) {
          outputReadOffset = initialBytes.offset;
          sendAgentOutputToProject(projectId, taskId, initialBytes.data);
          console.log(
            `[orchestrator] Recovery: streamed ${initialBytes.data.length} bytes of prior agent output`
          );
        }
      } catch {
        // Output file may not exist (agent using pipes, or not yet started writing)
      }
    }

    state.timers.setInterval(
      "recoveryPoll",
      async () => {
        let currentLastOutput = state.agent.lastOutputTime;
        if (wtPath) {
          const hb = await heartbeatService.readHeartbeat(wtPath, taskId);
          if (hb && hb.lastOutputTimestamp > currentLastOutput) {
            currentLastOutput = hb.lastOutputTimestamp;
            state.agent.lastOutputTime = currentLastOutput;
          }
        }

        // Stream new output from the log file to WebSocket clients
        if (outputLogPath) {
          try {
            const newData = await this.readOutputLogFrom(outputLogPath, outputReadOffset);
            if (newData.bytesRead > 0) {
              outputReadOffset += newData.bytesRead;
              sendAgentOutputToProject(projectId, taskId, newData.data);
            }
          } catch {
            // Transient read error
          }
        }

        const elapsed = Date.now() - currentLastOutput;
        if (elapsed > AGENT_INACTIVITY_TIMEOUT_MS && isPidAlive(pid)) {
          state.timers.clear("recoveryPoll");
          console.warn(
            `[orchestrator] Recovery: agent timeout for ${taskId} ` +
              `(${Math.round(elapsed / 1000)}s of inactivity), killing PID ${pid}`
          );
          state.agent.killedDueToTimeout = true;
          this.killPidGracefully(pid);
          setTimeout(async () => {
            this.killPidForcefully(pid);
            activeAgentsService.unregister(taskId);
            try {
              const task = await deps.beads.show(repoPath, taskId);
              await callbacks.handleTaskFailure(
                projectId,
                repoPath,
                task,
                branchName,
                `Agent killed after ${Math.round(elapsed / 1000)}s of inactivity (recovery timeout)`,
                null,
                "timeout"
              );
            } catch (err) {
              console.error("[orchestrator] Recovery: timeout handler failed:", err);
              await this.performCrashRecovery(
                projectId,
                repoPath,
                taskId,
                branchName,
                wtPath,
                persisted,
                state,
                deps,
                callbacks
              );
            }
          }, 5000);
          return;
        }

        if (isPidAlive(pid)) return;
        state.timers.clear("recoveryPoll");

        console.log(`[orchestrator] Recovery: agent PID ${pid} has exited, handling result`);
        try {
          const task = await deps.beads.show(repoPath, taskId);
          if (persisted.currentPhase === "review") {
            await callbacks.handleReviewDone(projectId, repoPath, task, branchName, null);
          } else {
            await callbacks.handleCodingDone(projectId, repoPath, task, branchName, null);
          }
        } catch (err) {
          console.error("[orchestrator] Recovery: post-exit handling failed:", err);
          await this.performCrashRecovery(
            projectId,
            repoPath,
            taskId,
            branchName,
            persisted.worktreePath,
            persisted,
            state,
            deps,
            callbacks
          );
        }
      },
      RECOVERY_POLL_MS
    );
  }

  /**
   * Scan `.opensprint/active/` for assignment.json files (GUPP pattern).
   * Returns assignments for tasks whose agents are no longer alive.
   */
  async findOrphanedAssignments(
    repoPath: string
  ): Promise<Array<{ taskId: string; assignment: TaskAssignment }>> {
    const activeDir = path.join(repoPath, OPENSPRINT_PATHS.active);
    const orphaned: Array<{ taskId: string; assignment: TaskAssignment }> = [];

    try {
      const entries = await readdir(activeDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
        const assignmentPath = path.join(activeDir, entry.name, OPENSPRINT_PATHS.assignment);
        try {
          const raw = await readFile(assignmentPath, "utf-8");
          const assignment = JSON.parse(raw) as TaskAssignment;
          orphaned.push({ taskId: entry.name, assignment });
        } catch {
          // No assignment.json — skip
        }
      }
    } catch {
      // No active directory — nothing to recover
    }

    return orphaned;
  }

  /**
   * Crash recovery with checkpoint detection.
   * Checks if the branch has meaningful committed work and preserves it
   * for the next attempt. Advances to review if result.json shows success.
   *
   * Enhanced with GUPP pattern: reads assignment.json for richer context
   * about the agent that was running.
   */
  async performCrashRecovery(
    projectId: string,
    repoPath: string,
    taskId: string,
    branchName: string,
    worktreePath: string | null | undefined,
    persisted: PersistedOrchestratorState | null | undefined,
    state: CrashRecoveryState,
    deps: CrashRecoveryDeps,
    callbacks: CrashRecoveryCallbacks
  ): Promise<void> {
    activeAgentsService.unregister(taskId);
    console.log(
      `[orchestrator] Recovery: crash recovery for task ${taskId} (branch ${branchName})`
    );

    // Read assignment.json if available (GUPP pattern — richer recovery context)
    let assignment: TaskAssignment | null = null;
    const assignmentDir = worktreePath
      ? path.join(worktreePath, OPENSPRINT_PATHS.active, taskId)
      : path.join(repoPath, OPENSPRINT_PATHS.active, taskId);
    try {
      const raw = await readFile(path.join(assignmentDir, OPENSPRINT_PATHS.assignment), "utf-8");
      assignment = JSON.parse(raw) as TaskAssignment;
      console.log("[orchestrator] Recovery: found assignment.json", {
        taskId: assignment.taskId,
        phase: assignment.phase,
        attempt: assignment.attempt,
      });
    } catch {
      // No assignment — use persisted state fallback
    }

    eventLogService
      .append(repoPath, {
        timestamp: new Date().toISOString(),
        projectId,
        taskId,
        event: "crash_recovery.started",
        data: {
          hasAssignment: !!assignment,
          phase: assignment?.phase ?? persisted?.currentPhase ?? "unknown",
        },
      })
      .catch(() => {});

    if (worktreePath && persisted && persisted.currentPhase === "coding") {
      const advanced = await this.tryAdvanceToReview(
        projectId,
        repoPath,
        taskId,
        branchName,
        worktreePath,
        persisted,
        state,
        deps,
        callbacks
      );
      if (advanced) return;
    }

    await callbacks.clearPersistedState(repoPath);

    const commitCount = await deps.branchManager.getCommitCountAhead(repoPath, branchName);
    const diff = await deps.branchManager.captureBranchDiff(repoPath, branchName);
    if (diff) {
      console.log(
        `[orchestrator] Recovery: captured ${diff.length} bytes of diff from ${branchName} (${commitCount} commits ahead)`
      );
    }

    try {
      await deps.branchManager.removeTaskWorktree(repoPath, taskId);
    } catch (err) {
      console.warn("[orchestrator] Recovery: worktree cleanup failed:", err);
    }

    if (commitCount > 0) {
      console.log(
        `[orchestrator] Recovery: preserving branch ${branchName} with ${commitCount} commits`
      );
      try {
        await deps.beads.comment(
          repoPath,
          taskId,
          `Agent crashed (backend restart). Branch preserved with ${commitCount} commits for next attempt.`
        );
      } catch (err) {
        console.warn("[orchestrator] Recovery: failed to add comment:", err);
      }
    } else {
      try {
        await deps.branchManager.deleteBranch(repoPath, branchName);
      } catch {
        // Branch may not exist
      }
      try {
        await deps.beads.comment(
          repoPath,
          taskId,
          "Agent crashed (backend restart). No committed work found, task requeued."
        );
      } catch (err) {
        console.warn("[orchestrator] Recovery: failed to add comment:", err);
      }
    }

    try {
      await deps.beads.update(repoPath, taskId, { status: "open", assignee: "" });
    } catch {
      // Task may already be in the right state
    }

    state.status.totalFailed += 1;
    state.status.currentTask = null;
    state.status.currentPhase = null;
    state.activeBranchName = null;
    state.activeTaskTitle = null;
    state.activeWorktreePath = null;
    state.loopActive = false;

    broadcastToProject(projectId, {
      type: "task.updated",
      taskId,
      status: "open",
      assignee: null,
    });

    console.log(`[orchestrator] Recovery: task ${taskId} requeued, resuming normal operation`);
  }

  /** Try to advance to review if result.json exists with success status. Returns true if advanced. */
  private async tryAdvanceToReview(
    projectId: string,
    repoPath: string,
    taskId: string,
    branchName: string,
    worktreePath: string,
    persisted: PersistedOrchestratorState,
    state: CrashRecoveryState,
    deps: CrashRecoveryDeps,
    callbacks: CrashRecoveryCallbacks
  ): Promise<boolean> {
    const result = (await deps.sessionManager.readResult(
      worktreePath,
      taskId
    )) as CodingAgentResult | null;

    if (result && result.status) {
      normalizeCodingStatus(result as CodingAgentResult);
    }

    const commitCount = await deps.branchManager.getCommitCountAhead(repoPath, branchName);
    if (!(result?.status === "success" && commitCount > 0)) return false;

    console.log(
      `[orchestrator] Recovery: found successful result.json with ${commitCount} commits, advancing to review`
    );

    try {
      const task = await deps.beads.show(repoPath, taskId);
      const settings = await deps.projectService.getSettings(projectId);
      const testCommand = resolveTestCommand(settings) || undefined;
      let changedFiles: string[] = [];
      try {
        changedFiles = await deps.branchManager.getChangedFiles(repoPath, branchName);
      } catch {
        // Fall back to full suite
      }
      const scopedResult = await deps.testRunner.runScopedTests(
        worktreePath,
        changedFiles,
        testCommand
      );

      if (scopedResult.failed === 0) {
        await callbacks.clearPersistedState(repoPath);
        state.status.currentTask = taskId;
        state.status.currentPhase = "review";
        state.activeBranchName = branchName;
        state.activeTaskTitle = persisted.currentTaskTitle ?? null;
        state.activeWorktreePath = worktreePath;
        state.attempt = persisted.attempt;
        state.agent.startedAt = persisted.startedAt ?? new Date().toISOString();
        state.phaseResult.codingDiff = await deps.branchManager.captureBranchDiff(
          repoPath,
          branchName
        );
        state.phaseResult.codingSummary = (result as CodingAgentResult).summary ?? "";
        state.phaseResult.testResults = scopedResult;
        state.phaseResult.testOutput = (scopedResult as { rawOutput?: string }).rawOutput ?? "";

        await deps.branchManager.commitWip(worktreePath, taskId);

        const reviewMode = settings.reviewMode ?? DEFAULT_REVIEW_MODE;
        if (reviewMode === "never") {
          await callbacks.performMergeAndDone(projectId, repoPath, task, branchName);
        } else {
          await callbacks.persistState(projectId, repoPath);
          broadcastToProject(projectId, {
            type: "task.updated",
            taskId,
            status: "in_progress",
            assignee: "agent-1",
          });
          broadcastToProject(projectId, {
            type: "execute.status",
            currentTask: taskId,
            currentPhase: "review",
            queueDepth: state.status.queueDepth,
          });
          await callbacks.executeReviewPhase(projectId, repoPath, task, branchName);
        }
        return true;
      }
    } catch (err) {
      console.warn("[orchestrator] Recovery: result.json advance-to-review failed:", err);
    }
    return false;
  }

  /**
   * Read up to maxBytes from the end of an output log file.
   * Returns the data and the file offset after reading (for subsequent reads).
   */
  private async readOutputLogTail(
    logPath: string,
    maxBytes: number
  ): Promise<{ data: string; offset: number }> {
    const s = await fsStat(logPath);
    if (s.size === 0) return { data: "", offset: 0 };
    const start = Math.max(0, s.size - maxBytes);
    const toRead = s.size - start;
    const fh = await fsOpen(logPath, "r");
    try {
      const buf = Buffer.alloc(toRead);
      const { bytesRead } = await fh.read(buf, 0, toRead, start);
      return { data: buf.subarray(0, bytesRead).toString(), offset: start + bytesRead };
    } finally {
      await fh.close();
    }
  }

  /** Read new bytes from the output log starting at the given offset. */
  private async readOutputLogFrom(
    logPath: string,
    offset: number
  ): Promise<{ data: string; bytesRead: number }> {
    const s = await fsStat(logPath);
    if (s.size <= offset) return { data: "", bytesRead: 0 };
    const toRead = Math.min(s.size - offset, 256 * 1024);
    const fh = await fsOpen(logPath, "r");
    try {
      const buf = Buffer.alloc(toRead);
      const { bytesRead } = await fh.read(buf, 0, toRead, offset);
      return { data: buf.subarray(0, bytesRead).toString(), bytesRead };
    } finally {
      await fh.close();
    }
  }

  private killPidGracefully(pid: number): void {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already dead */
      }
    }
  }

  private killPidForcefully(pid: number): void {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* ignore */
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* ignore */
    }
  }
}
