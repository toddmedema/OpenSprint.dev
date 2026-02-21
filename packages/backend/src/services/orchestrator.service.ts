import fs from "fs/promises";
import path from "path";
import type {
  OrchestratorStatus,
  ActiveAgent,
  ActiveTaskConfig,
  CodingAgentResult,
  ReviewAgentResult,
  TestResults,
  PendingFeedbackCategorization,
  AgentConfig,
} from "@opensprint/shared";
import {
  OPENSPRINT_PATHS,
  BACKOFF_FAILURE_THRESHOLD,
  MAX_PRIORITY_BEFORE_BLOCK,
  resolveTestCommand,
  DEFAULT_REVIEW_MODE,
  getCodingAgentForComplexity,
} from "@opensprint/shared";
import { BeadsService, type BeadsIssue } from "./beads.service.js";
import { ProjectService } from "./project.service.js";
import { agentService } from "./agent.service.js";
import { triggerDeploy } from "./deploy-trigger.service.js";
import { BranchManager, RebaseConflictError } from "./branch-manager.js";
import {
  gitCommitQueue,
  RepoConflictError,
} from "./git-commit-queue.service.js";
import { ContextAssembler } from "./context-assembler.js";
import { SessionManager } from "./session-manager.js";
import { shouldInvokeSummarizer, buildSummarizerPrompt, countWords } from "./summarizer.service.js";
import type { TaskContext } from "./context-assembler.js";
import { TestRunner } from "./test-runner.js";
import { orphanRecoveryService } from "./orphan-recovery.service.js";
import { activeAgentsService } from "./active-agents.service.js";
import { FeedbackService } from "./feedback.service.js";
import { broadcastToProject, sendAgentOutputToProject } from "../websocket/index.js";
import { writeJsonAtomic } from "../utils/file-utils.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { extractJsonFromAgentResponse } from "../utils/json-extract.js";
import { TimerRegistry } from "./timer-registry.js";
import { AgentLifecycleManager, type AgentRunState } from "./agent-lifecycle.js";
import { CrashRecoveryService } from "./crash-recovery.service.js";
import { FileScopeAnalyzer, type FileScope } from "./file-scope-analyzer.js";
import { normalizeCodingStatus, normalizeReviewStatus } from "./result-normalizers.js";
import { getPlanComplexityForTask } from "./plan-complexity.js";
import { eventLogService } from "./event-log.service.js";
import { agentIdentityService, type AttemptOutcome } from "./agent-identity.service.js";
import { createLogger } from "../utils/logger.js";
import {
  PhaseExecutorService,
  type PhaseExecutorHost,
} from "./phase-executor.service.js";

const log = createLogger("orchestrator");

/**
 * Failure types for smarter recovery routing.
 * Only agent-attributable failures count toward progressive backoff.
 */
type FailureType =
  | "test_failure"
  | "review_rejection"
  | "agent_crash"
  | "timeout"
  | "no_result"
  | "merge_conflict"
  | "coding_failure";

/** Failures caused by infrastructure, not the agent's work quality */
const INFRA_FAILURE_TYPES: FailureType[] = ["agent_crash", "timeout", "merge_conflict"];

/** Max number of free infrastructure retries before counting toward backoff */
const MAX_INFRA_RETRIES = 2;

interface RetryContext {
  previousFailure?: string;
  reviewFeedback?: string;
  useExistingBranch?: boolean;
  previousTestOutput?: string;
  previousDiff?: string;
  failureType?: FailureType;
}

/** Loop kicker interval: 60s — restarts idle orchestrator loop (distinct from 5-min WatchdogService health patrol). */
const LOOP_KICKER_INTERVAL_MS = 60 * 1000;

/**
 * GUPP-style assignment file: everything an agent needs to self-start.
 * Written before agent spawn so crash recovery can simply re-read and re-spawn.
 */
export interface TaskAssignment {
  taskId: string;
  projectId: string;
  phase: "coding" | "review";
  branchName: string;
  worktreePath: string;
  promptPath: string;
  agentConfig: AgentConfig;
  attempt: number;
  retryContext?: RetryContext;
  createdAt: string;
}

/** Check whether a PID is still running */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Extract epic ID from task ID (e.g. bd-a3f8.2 -> bd-a3f8). Returns null if not a child task. */
function extractEpicId(id: string | undefined | null): string | null {
  if (id == null || typeof id !== "string") return null;
  const lastDot = id.lastIndexOf(".");
  if (lastDot <= 0) return null;
  return id.slice(0, lastDot);
}

/** Format review rejection result into actionable feedback for the coding agent retry prompt. Exported for testing. */
export function formatReviewFeedback(result: ReviewAgentResult): string {
  const parts: string[] = [];
  if (result.summary) {
    parts.push(result.summary);
  }
  if (result.issues && result.issues.length > 0) {
    parts.push("\n\nIssues to address:");
    for (const issue of result.issues) {
      parts.push(`\n- ${issue}`);
    }
  }
  if (result.notes?.trim()) {
    parts.push(`\n\nNotes: ${result.notes.trim()}`);
  }
  if (parts.length === 0) {
    return "Review rejected (no details provided by review agent).";
  }
  return parts.join("");
}

/** Results carried over from coding phase to review/merge */
interface PhaseResult {
  codingDiff: string;
  codingSummary: string;
  testResults: TestResults | null;
  testOutput: string;
}

// ─── Slot-based State Model (v2) ───

/** Per-task agent slot. Encapsulates all state for one active agent. */
export interface AgentSlot {
  taskId: string;
  taskTitle: string | null;
  branchName: string;
  worktreePath: string | null;
  agent: AgentRunState;
  phase: "coding" | "review";
  attempt: number;
  phaseResult: PhaseResult;
  infraRetries: number;
  timers: TimerRegistry;
  fileScope?: FileScope;
}

interface OrchestratorState {
  status: OrchestratorStatus;
  loopActive: boolean;
  globalTimers: TimerRegistry;
  slots: Map<string, AgentSlot>;
  pendingFeedbackCategorizations: PendingFeedbackCategorization[];
}

/** Discriminated union for orchestrator state transitions */
type TransitionTarget =
  | {
      to: "start_task";
      taskId: string;
      taskTitle: string | null;
      branchName: string;
      attempt: number;
      queueDepth: number;
    }
  | { to: "enter_review"; taskId: string; queueDepth: number }
  | { to: "complete"; taskId: string }
  | { to: "fail"; taskId: string };

/** Persisted counters (lightweight replacement for orchestrator-state.json) */
interface OrchestratorCounters {
  totalDone: number;
  totalFailed: number;
  queueDepth: number;
}

/**
 * Build orchestrator service.
 * Manages the multi-agent build loop: poll bd ready -> assign -> spawn agent -> monitor -> handle result.
 * Supports concurrent coder agents via slot-based state model.
 */
export class OrchestratorService {
  private state = new Map<string, OrchestratorState>();
  private beads = new BeadsService();
  private projectService = new ProjectService();
  private branchManager = new BranchManager();
  private contextAssembler = new ContextAssembler();
  private sessionManager = new SessionManager();
  private testRunner = new TestRunner();
  private feedbackService = new FeedbackService();
  private lifecycleManager = new AgentLifecycleManager();
  private crashRecovery = new CrashRecoveryService();
  private fileScopeAnalyzer = new FileScopeAnalyzer();
  /** Cached repoPath per project (avoids async lookup in synchronous transition()) */
  private repoPathCache = new Map<string, string>();
  /** Cached maxConcurrentCoders per project (avoids async lookup in synchronous nudge()) */
  private maxSlotsCache = new Map<string, number>();
  /** Guard against concurrent pushes per project */
  private pushInProgress = new Set<string>();
  /** Promise per project that resolves when the current push completes */
  private pushCompletion = new Map<string, { promise: Promise<void>; resolve: () => void }>();

  private phaseExecutor = new PhaseExecutorService(this as unknown as PhaseExecutorHost, {
    handleCodingDone: (a, b, c, d, e) => this.handleCodingDone(a, b, c, d, e),
    handleReviewDone: (a, b, c, d, e) => this.handleReviewDone(a, b, c, d, e),
    handleTaskFailure: (a, b, c, d, e, f, g, h) =>
      this.handleTaskFailure(a, b, c, d, e, f, g as FailureType | undefined, h),
  });

  private getState(projectId: string): OrchestratorState {
    if (!this.state.has(projectId)) {
      this.state.set(projectId, {
        status: this.defaultStatus(),
        loopActive: false,
        globalTimers: new TimerRegistry(),
        slots: new Map(),
        pendingFeedbackCategorizations: [],
      });
    }
    return this.state.get(projectId)!;
  }

  private defaultStatus(): OrchestratorStatus {
    return {
      activeTasks: [],
      queueDepth: 0,
      totalDone: 0,
      totalFailed: 0,
    };
  }

  /** Create a new AgentSlot for a task */
  private createSlot(taskId: string, taskTitle: string | null, branchName: string, attempt: number): AgentSlot {
    return {
      taskId,
      taskTitle,
      branchName,
      worktreePath: null,
      agent: {
        activeProcess: null,
        lastOutputTime: 0,
        outputLog: [],
        outputLogBytes: 0,
        startedAt: "",
        exitHandled: false,
        killedDueToTimeout: false,
      },
      phase: "coding",
      attempt,
      phaseResult: { codingDiff: "", codingSummary: "", testResults: null, testOutput: "" },
      infraRetries: 0,
      timers: new TimerRegistry(),
    };
  }

  /** Build activeTasks array from current slots for status/broadcast */
  private buildActiveTasks(state: OrchestratorState): OrchestratorStatus["activeTasks"] {
    const tasks: OrchestratorStatus["activeTasks"] = [];
    for (const slot of state.slots.values()) {
      tasks.push({
        taskId: slot.taskId,
        phase: slot.phase,
        startedAt: slot.agent.startedAt || new Date().toISOString(),
      });
    }
    return tasks;
  }

  /**
   * Centralized state transition with logging and broadcasting.
   */
  private transition(projectId: string, t: TransitionTarget): void {
    const state = this.getState(projectId);

    switch (t.to) {
      case "start_task": {
        const slot = state.slots.get(t.taskId);
        broadcastToProject(projectId, {
          type: "task.updated",
          taskId: t.taskId,
          status: "in_progress",
          assignee: "agent-1",
        });
        broadcastToProject(projectId, {
          type: "execute.status",
          activeTasks: this.buildActiveTasks(state),
          queueDepth: t.queueDepth,
        });
        break;
      }

      case "enter_review": {
        const slot = state.slots.get(t.taskId);
        if (slot) slot.phase = "review";
        broadcastToProject(projectId, {
          type: "task.updated",
          taskId: t.taskId,
          status: "in_progress",
          assignee: "agent-1",
        });
        broadcastToProject(projectId, {
          type: "execute.status",
          activeTasks: this.buildActiveTasks(state),
          queueDepth: t.queueDepth,
        });
        break;
      }

      case "complete":
        state.status.totalDone += 1;
        this.removeSlot(state, t.taskId);
        broadcastToProject(projectId, {
          type: "task.updated",
          taskId: t.taskId,
          status: "closed",
          assignee: null,
        });
        break;

      case "fail":
        state.status.totalFailed += 1;
        this.removeSlot(state, t.taskId);
        break;
    }

    const activeTask = state.slots.get(t.taskId);
    log.info(
      `Transition [${projectId}]: → ${t.to} (task: ${t.taskId})`
    );

    const repoPath = this.repoPathCache.get(projectId);
    if (repoPath) {
      eventLogService
        .append(repoPath, {
          timestamp: new Date().toISOString(),
          projectId,
          taskId: t.taskId,
          event: `transition.${t.to}`,
          data: { attempt: activeTask?.attempt },
        })
        .catch(() => {});
    }
  }

  /** Remove a slot and clean up its per-slot timers */
  private removeSlot(state: OrchestratorState, taskId: string): void {
    const slot = state.slots.get(taskId);
    if (slot) {
      slot.timers.clearAll();
      state.slots.delete(taskId);
    }
    state.status.activeTasks = this.buildActiveTasks(state);
  }

  /** Delete assignment.json for a task */
  private async deleteAssignment(repoPath: string, taskId: string): Promise<void> {
    const assignmentPath = path.join(
      repoPath,
      OPENSPRINT_PATHS.active,
      taskId,
      OPENSPRINT_PATHS.assignment
    );
    try {
      await fs.unlink(assignmentPath);
    } catch {
      // File may not exist
    }
  }

  // ─── Counters Persistence ───

  private async persistCounters(projectId: string, repoPath: string): Promise<void> {
    const state = this.getState(projectId);
    const counters: OrchestratorCounters = {
      totalDone: state.status.totalDone,
      totalFailed: state.status.totalFailed,
      queueDepth: state.status.queueDepth,
    };
    const countersPath = path.join(repoPath, OPENSPRINT_PATHS.orchestratorCounters);
    try {
      await fs.mkdir(path.dirname(countersPath), { recursive: true });
      await writeJsonAtomic(countersPath, counters);
    } catch (err) {
      log.warn("Failed to persist counters", { err });
    }
  }

  private async loadCounters(repoPath: string): Promise<OrchestratorCounters | null> {
    const countersPath = path.join(repoPath, OPENSPRINT_PATHS.orchestratorCounters);
    try {
      const raw = await fs.readFile(countersPath, "utf-8");
      return JSON.parse(raw) as OrchestratorCounters;
    } catch {
      return null;
    }
  }

  // ─── Crash Recovery (GUPP-style: scan assignment.json files) ───

  private async recoverActiveSlots(projectId: string, repoPath: string): Promise<void> {
    const orphaned = await this.crashRecovery.findOrphanedAssignments(repoPath);
    if (orphaned.length === 0) return;

    const state = this.getState(projectId);

    for (const { taskId, assignment } of orphaned) {
      log.info("Recovery: found orphaned assignment", {
        taskId,
        phase: assignment.phase,
      });

      let task: BeadsIssue;
      try {
        task = await this.beads.show(repoPath, taskId);
      } catch {
        log.warn("Recovery: task not found, cleaning up assignment", { taskId });
        await this.deleteAssignment(repoPath, taskId);
        continue;
      }

      // Check if task is still in_progress — if not, clean up stale assignment
      if ((task.status as string) !== "in_progress") {
        log.info("Recovery: task no longer in_progress, removing stale assignment", {
          taskId,
          status: task.status,
        });
        await this.deleteAssignment(repoPath, taskId);
        continue;
      }

      // Requeue the task: reset to open and let the loop pick it up
      try {
        await this.beads.update(repoPath, taskId, { status: "open", assignee: "" });
        await this.beads.comment(
          repoPath,
          taskId,
          "Agent crashed (backend restart). Task requeued for next attempt."
        );
      } catch (err) {
        log.warn("Recovery: failed to requeue task", { taskId, err });
      }

      await this.deleteAssignment(repoPath, taskId);
      state.status.totalFailed += 1;

      broadcastToProject(projectId, {
        type: "task.updated",
        taskId,
        status: "open",
        assignee: null,
      });
    }
  }

  // ─── Lifecycle ───

  stopProject(projectId: string): void {
    const state = this.state.get(projectId);
    if (!state) return;

    log.info(`Stopping orchestrator for project ${projectId}`);

    state.globalTimers.clearAll();

    for (const slot of state.slots.values()) {
      slot.timers.clearAll();
      if (slot.agent.activeProcess) {
        activeAgentsService.unregister(slot.taskId);
        const preserveAgents = process.env.OPENSPRINT_PRESERVE_AGENTS === "1";
        if (!preserveAgents) {
          try {
            slot.agent.activeProcess.kill();
          } catch {
            // Process may already be dead
          }
        }
        slot.agent.activeProcess = null;
      }
    }

    state.loopActive = false;
    this.state.delete(projectId);

    log.info(`Orchestrator stopped for project ${projectId}`);
  }

  stopAll(): void {
    for (const projectId of [...this.state.keys()]) {
      this.stopProject(projectId);
    }
  }

  async ensureRunning(projectId: string): Promise<OrchestratorStatus> {
    await this.projectService.getProject(projectId);
    const state = this.getState(projectId);
    const repoPath = await this.projectService.getRepoPath(projectId);
    this.repoPathCache.set(projectId, repoPath);

    // Orphan recovery: reset in_progress tasks with agent assignee but no active process
    try {
      const orphanResult = await orphanRecoveryService.recoverOrphanedTasks(repoPath);
      if (orphanResult.recovered.length > 0) {
        log.warn(`Recovered ${orphanResult.recovered.length} orphaned task(s) on startup`);
      }
    } catch (err) {
      log.error("Orphan recovery failed", { err });
    }

    // Stale heartbeat recovery
    try {
      const staleResult = await orphanRecoveryService.recoverFromStaleHeartbeats(repoPath);
      if (staleResult.recovered.length > 0) {
        log.warn(`Recovered ${staleResult.recovered.length} stale heartbeat task(s) on startup`);
      }
    } catch (err) {
      log.error("Stale heartbeat recovery failed", { err });
    }

    // GUPP-style crash recovery: scan assignment.json files
    await this.recoverActiveSlots(projectId, repoPath);

    // Cache maxConcurrentCoders for synchronous nudge()
    try {
      const settings = await this.projectService.getSettings(projectId);
      this.maxSlotsCache.set(projectId, settings.maxConcurrentCoders ?? 1);
    } catch {
      this.maxSlotsCache.set(projectId, 1);
    }

    // Restore counters from persisted file
    const counters = await this.loadCounters(repoPath);
    if (counters) {
      state.status.totalDone = counters.totalDone;
      state.status.totalFailed = counters.totalFailed;
    }

    // Start loop kicker timer if not already running (nudges when idle; distinct from WatchdogService)
    if (!state.globalTimers.has("loopKicker")) {
      state.globalTimers.setInterval(
        "loopKicker",
        () => {
          this.nudge(projectId);
        },
        LOOP_KICKER_INTERVAL_MS
      );
      log.info("Loop kicker started (60s interval) for project", { projectId });
    }

    if (!state.loopActive) {
      this.nudge(projectId);
    }

    return state.status;
  }

  nudge(projectId: string): void {
    const state = this.getState(projectId);

    const maxSlots = this.maxSlotsCache.get(projectId) ?? 1;

    if (state.loopActive || state.globalTimers.has("loop") || state.slots.size >= maxSlots) {
      return;
    }

    log.info("Nudge received, starting loop for project", { projectId });
    this.runLoop(projectId);
  }

  async getStatus(projectId: string): Promise<OrchestratorStatus> {
    await this.projectService.getProject(projectId);
    const state = this.getState(projectId);
    return {
      ...state.status,
      activeTasks: this.buildActiveTasks(state),
      worktreePath: state.slots.size === 1
        ? [...state.slots.values()][0]?.worktreePath ?? null
        : null,
      pendingFeedbackCategorizations: state.pendingFeedbackCategorizations ?? [],
    };
  }

  async getLiveOutput(projectId: string, taskId: string): Promise<string> {
    await this.projectService.getProject(projectId);
    const state = this.getState(projectId);
    const slot = state.slots.get(taskId);
    if (!slot || !slot.agent.outputLog.length) {
      return "";
    }
    return slot.agent.outputLog.join("");
  }

  async getActiveAgents(projectId: string): Promise<ActiveAgent[]> {
    await this.projectService.getProject(projectId);
    const registered = activeAgentsService.list(projectId);
    if (registered.length > 0) return registered;

    const state = this.getState(projectId);
    const agents: ActiveAgent[] = [];
    for (const slot of state.slots.values()) {
      agents.push({
        id: slot.taskId,
        phase: slot.phase,
        role: slot.phase === "review" ? "reviewer" : "coder",
        label: slot.taskTitle ?? slot.taskId,
        startedAt: slot.agent.startedAt || new Date().toISOString(),
        branchName: slot.branchName,
      });
    }
    return agents;
  }

  // ─── Main Orchestrator Loop ───

  private async runLoop(projectId: string): Promise<void> {
    const state = this.getState(projectId);

    state.loopActive = true;
    state.globalTimers.clear("loop");

    try {
      const repoPath = await this.projectService.getRepoPath(projectId);
      const settings = await this.projectService.getSettings(projectId);
      const maxSlots = settings.maxConcurrentCoders ?? 1;
      this.maxSlotsCache.set(projectId, maxSlots);

      let readyTasks = await this.beads.ready(repoPath);

      readyTasks = readyTasks.filter((t) => (t.title ?? "") !== "Plan approval gate");
      readyTasks = readyTasks.filter((t) => (t.issue_type ?? t.type) !== "epic");
      readyTasks = readyTasks.filter((t) => (t.status as string) !== "blocked");
      // Exclude tasks that already have an active slot
      readyTasks = readyTasks.filter((t) => !state.slots.has(t.id));

      state.status.queueDepth = readyTasks.length;

      const slotsAvailable = maxSlots - state.slots.size;
      if (readyTasks.length === 0 || slotsAvailable <= 0) {
        log.info("No ready tasks or no slots available, going idle", {
          projectId,
          readyTasks: readyTasks.length,
          slotsAvailable,
        });
        state.loopActive = false;
        broadcastToProject(projectId, {
          type: "execute.status",
          activeTasks: this.buildActiveTasks(state),
          queueDepth: state.status.queueDepth,
        });
        return;
      }

      // Pick the highest-priority task with all blockers closed
      const statusMap = await this.beads.getStatusMap(repoPath);
      let task: BeadsIssue | null = null;
      for (const t of readyTasks) {
        const allClosed = await this.beads.areAllBlockersClosed(repoPath, t.id, statusMap);
        if (allClosed) {
          task = t;
          break;
        }
        log.info("Skipping task (blockers not all closed)", {
          projectId,
          taskId: t.id,
          title: t.title,
        });
      }
      if (!task) {
        log.info("No task with all blockers closed, going idle", { projectId });
        state.loopActive = false;
        broadcastToProject(projectId, {
          type: "execute.status",
          activeTasks: this.buildActiveTasks(state),
          queueDepth: 0,
        });
        return;
      }
      log.info("Picking task", { projectId, taskId: task.id, title: task.title });

      // Assign the task
      await this.beads.update(repoPath, task.id, {
        status: "in_progress",
        assignee: "agent-1",
      });

      gitCommitQueue.enqueue({
        type: "beads_export",
        repoPath,
        summary: `claimed ${task.id}`,
      });

      const cumulativeAttempts = await this.beads.getCumulativeAttempts(repoPath, task.id);
      const branchName = `opensprint/${task.id}`;

      // Create a slot for this task
      const slot = this.createSlot(task.id, task.title ?? null, branchName, cumulativeAttempts + 1);
      state.slots.set(task.id, slot);

      this.transition(projectId, {
        to: "start_task",
        taskId: task.id,
        taskTitle: task.title ?? null,
        branchName,
        attempt: cumulativeAttempts + 1,
        queueDepth: readyTasks.length - 1,
      });

      await this.persistCounters(projectId, repoPath);

      await this.branchManager.ensureOnMain(repoPath);

      await this.executeCodingPhase(projectId, repoPath, task, slot, undefined);

      // Mark loop as idle so nudge can fire again for additional slots
      state.loopActive = false;
    } catch (error) {
      log.error(`Orchestrator loop error for project ${projectId}`, { error });
      state.loopActive = false;
      state.globalTimers.setTimeout("loop", () => this.runLoop(projectId), 10000);
    }
  }

  private async executeCodingPhase(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    slot: AgentSlot,
    retryContext?: RetryContext
  ): Promise<void> {
    return this.phaseExecutor.executeCodingPhase(projectId, repoPath, task, slot, retryContext);
  }

  private async handleCodingDone(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    branchName: string,
    exitCode: number | null
  ): Promise<void> {
    const state = this.getState(projectId);
    const slot = state.slots.get(task.id);
    if (!slot) {
      log.warn("handleCodingDone: no slot found for task", { taskId: task.id });
      return;
    }
    const wtPath = slot.worktreePath ?? repoPath;

    const result = (await this.sessionManager.readResult(
      wtPath,
      task.id
    )) as CodingAgentResult | null;

    if (result && result.status) {
      normalizeCodingStatus(result);
    }

    if (!result) {
      const failureType: FailureType = slot.agent.killedDueToTimeout
        ? "timeout"
        : exitCode === 143 || exitCode === 137
          ? "agent_crash"
          : "no_result";
      slot.agent.killedDueToTimeout = false;
      await this.handleTaskFailure(
        projectId,
        repoPath,
        task,
        branchName,
        `Agent exited with code ${exitCode} without producing a result`,
        null,
        failureType
      );
      return;
    }

    if (result.status === "success") {
      slot.phaseResult.codingDiff = await this.branchManager.captureBranchDiff(
        repoPath,
        branchName
      );
      slot.phaseResult.codingSummary = result.summary ?? "";

      const settings = await this.projectService.getSettings(projectId);
      const testCommand = resolveTestCommand(settings) || undefined;
      let changedFiles: string[] = [];
      try {
        changedFiles = await this.branchManager.getChangedFiles(repoPath, branchName);
      } catch {
        // Fall back to full suite
      }
      const scopedResult = await this.testRunner.runScopedTests(wtPath, changedFiles, testCommand);
      slot.phaseResult.testOutput = scopedResult.rawOutput;

      if (scopedResult.failed > 0) {
        await this.handleTaskFailure(
          projectId,
          repoPath,
          task,
          branchName,
          `Tests failed: ${scopedResult.failed} failed, ${scopedResult.passed} passed`,
          scopedResult,
          "test_failure"
        );
        return;
      }

      slot.phaseResult.testResults = scopedResult;

      await this.branchManager.commitWip(wtPath, task.id);

      const reviewMode = settings.reviewMode ?? DEFAULT_REVIEW_MODE;

      if (reviewMode === "never") {
        await this.performMergeAndDone(projectId, repoPath, task, branchName);
      } else {
        this.transition(projectId, {
          to: "enter_review",
          taskId: task.id,
          queueDepth: state.status.queueDepth,
        });
        await this.persistCounters(projectId, repoPath);
        await this.executeReviewPhase(projectId, repoPath, task, branchName);
      }
    } else {
      const reason = result.summary || `Agent exited with code ${exitCode}`;
      await this.handleTaskFailure(
        projectId,
        repoPath,
        task,
        branchName,
        reason,
        null,
        "coding_failure"
      );
    }
  }

  private async executeReviewPhase(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    branchName: string
  ): Promise<void> {
    return this.phaseExecutor.executeReviewPhase(projectId, repoPath, task, branchName);
  }

  private async handleReviewDone(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    branchName: string,
    exitCode: number | null
  ): Promise<void> {
    const state = this.getState(projectId);
    const slot = state.slots.get(task.id);
    if (!slot) {
      log.warn("handleReviewDone: no slot found for task", { taskId: task.id });
      return;
    }
    const wtPath = slot.worktreePath ?? repoPath;
    const result = (await this.sessionManager.readResult(
      wtPath,
      task.id
    )) as ReviewAgentResult | null;

    if (result && result.status) {
      normalizeReviewStatus(result);
    }

    if (result && result.status === "approved") {
      await this.performMergeAndDone(projectId, repoPath, task, branchName);
    } else if (result && result.status === "rejected") {
      const reason = `Review rejected: ${result.issues?.join("; ") || result.summary || "No details provided"}`;
      const reviewFeedback = formatReviewFeedback(result);

      let gitDiff = "";
      try {
        const branchDiff = await this.branchManager.captureBranchDiff(repoPath, branchName);
        const uncommittedDiff = await this.branchManager.captureUncommittedDiff(wtPath);
        gitDiff = [branchDiff, uncommittedDiff]
          .filter(Boolean)
          .join("\n\n--- Uncommitted changes ---\n\n");
      } catch {
        // Best-effort capture
      }

      const session = await this.sessionManager.createSession(repoPath, {
        taskId: task.id,
        attempt: slot.attempt,
        agentType: (await this.projectService.getSettings(projectId)).codingAgent.type,
        agentModel: (await this.projectService.getSettings(projectId)).codingAgent.model || "",
        gitBranch: branchName,
        status: "rejected",
        outputLog: slot.agent.outputLog.join(""),
        failureReason: result.summary || "Review rejected (no summary provided)",
        gitDiff: gitDiff || undefined,
        startedAt: slot.agent.startedAt,
      });
      await this.sessionManager.archiveSession(repoPath, task.id, slot.attempt, session, wtPath);

      await this.handleTaskFailure(
        projectId,
        repoPath,
        task,
        branchName,
        reason,
        null,
        "review_rejection",
        reviewFeedback
      );
    } else {
      const failureType: FailureType = slot.agent.killedDueToTimeout
        ? "timeout"
        : exitCode === 143 || exitCode === 137
          ? "agent_crash"
          : "no_result";
      slot.agent.killedDueToTimeout = false;
      await this.handleTaskFailure(
        projectId,
        repoPath,
        task,
        branchName,
        `Review agent exited with code ${exitCode} without producing a valid result`,
        null,
        failureType
      );
    }
  }

  private async buildReviewHistory(repoPath: string, taskId: string): Promise<string> {
    try {
      const sessions = await this.sessionManager.listSessions(repoPath, taskId);
      const rejections = sessions
        .filter((s) => s.status === "rejected")
        .sort((a, b) => a.attempt - b.attempt);

      if (rejections.length === 0) return "";

      const parts: string[] = [];
      for (const session of rejections) {
        parts.push(`### Attempt ${session.attempt} — Rejected`);
        if (session.failureReason) {
          parts.push(`\n**Reason:** ${session.failureReason}`);
        }
        parts.push("");
      }
      return parts.join("\n");
    } catch {
      return "";
    }
  }

  /**
   * Merge to main, close task, archive session, clean up.
   * Uses async merge pattern: enqueues merge with callbacks and releases the slot immediately,
   * allowing the next task to start while the merge is in progress.
   */
  private async performMergeAndDone(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    branchName: string
  ): Promise<void> {
    const state = this.getState(projectId);
    const slot = state.slots.get(task.id);
    if (!slot) {
      log.warn("performMergeAndDone: no slot found for task", { taskId: task.id });
      return;
    }
    const wtPath = slot.worktreePath ?? repoPath;

    await this.branchManager.waitForGitReady(wtPath);
    await this.branchManager.commitWip(wtPath, task.id);

    await this.waitForPushComplete(projectId);

    // --- Pre-merge (synchronous): archive session, record attempt, close task ---

    const settings = await this.projectService.getSettings(projectId);
    agentIdentityService
      .recordAttempt(repoPath, {
        taskId: task.id,
        agentId: `${settings.codingAgent.type}-${settings.codingAgent.model ?? "default"}`,
        model: settings.codingAgent.model ?? "unknown",
        attempt: slot.attempt,
        startedAt: slot.agent.startedAt,
        completedAt: new Date().toISOString(),
        outcome: "success",
        durationMs: Date.now() - new Date(slot.agent.startedAt).getTime(),
      })
      .catch((err) => log.warn("Failed to record attempt", { err }));

    const session = await this.sessionManager.createSession(repoPath, {
      taskId: task.id,
      attempt: slot.attempt,
      agentType: settings.codingAgent.type,
      agentModel: settings.codingAgent.model || "",
      gitBranch: branchName,
      status: "approved",
      outputLog: slot.agent.outputLog.join(""),
      gitDiff: slot.phaseResult.codingDiff,
      summary: slot.phaseResult.codingSummary || undefined,
      testResults: slot.phaseResult.testResults ?? undefined,
      startedAt: slot.agent.startedAt,
    });
    await this.sessionManager.archiveSession(repoPath, task.id, slot.attempt, session, wtPath);

    // Record actual files for future file-scope inference
    try {
      const changedFiles = await this.branchManager.getChangedFiles(repoPath, branchName);
      await this.fileScopeAnalyzer.recordActual(repoPath, task.id, changedFiles, this.beads);
    } catch {
      // best-effort
    }

    // Capture slot data before removing it
    const slotPhaseResult = { ...slot.phaseResult };
    const slotAttempt = slot.attempt;

    // Transition to complete — this removes the slot and frees capacity
    this.transition(projectId, { to: "complete", taskId: task.id });

    eventLogService
      .append(repoPath, {
        timestamp: new Date().toISOString(),
        projectId,
        taskId: task.id,
        event: "task.completed",
        data: { attempt: slotAttempt },
      })
      .catch(() => {});

    await this.persistCounters(projectId, repoPath);

    broadcastToProject(projectId, {
      type: "agent.completed",
      taskId: task.id,
      status: "approved",
      testResults: slotPhaseResult.testResults,
    });

    // Immediately nudge to fill the freed slot
    this.nudge(projectId);

    // --- Async merge: enqueue merge job, do cleanup in callbacks ---
    try {
      await gitCommitQueue.enqueueAndWait({
        type: "worktree_merge",
        repoPath,
        branchName,
        taskTitle: task.title || task.id,
        beadsClose: {
          taskId: task.id,
          reason: slotPhaseResult.codingSummary || "Implemented and tested",
        },
      });

      // Clean up worktree and branch after merge
      await this.branchManager.removeTaskWorktree(repoPath, task.id);
      await this.branchManager.deleteBranch(repoPath, branchName);
    } catch (mergeErr) {
      log.warn("Merge to main failed", { mergeErr });

      if (mergeErr instanceof RepoConflictError) {
        const mergeActive = await this.branchManager.isMergeInProgress(repoPath);
        if (mergeActive) {
          log.info("Merge conflicts detected, spawning merger agent to resolve");
          try {
            const resolved = await this.spawnMergerAgent(
              projectId,
              repoPath,
              mergeErr.unmergedFiles,
              "merge"
            );
            if (resolved) {
              log.info("Merger agent resolved merge conflicts, continuing");
              await this.beads.close(
                repoPath,
                task.id,
                slotPhaseResult.codingSummary || "Implemented and tested"
              );
              gitCommitQueue.enqueue({
                type: "beads_export",
                repoPath,
                summary: `closed ${task.id}`,
              });
            } else {
              await this.branchManager.mergeAbort(repoPath);
              log.error("Merger agent failed for completed task", { taskId: task.id });
            }
          } catch (mergerErr) {
            log.warn("Merger agent error during merge resolution", { mergerErr });
            await this.branchManager.mergeAbort(repoPath);
          }
        }
      } else {
        const merged = await this.branchManager.verifyMerge(repoPath, branchName);
        if (!merged) {
          log.error("Merge failed for completed task (non-conflict)", { taskId: task.id });
        }
      }

      // Clean up regardless
      try {
        await this.branchManager.removeTaskWorktree(repoPath, task.id);
        await this.branchManager.deleteBranch(repoPath, branchName);
      } catch {
        // best-effort cleanup
      }
    }

    // Fire-and-forget: push to remote, auto-deploy, and feedback checks.
    this.postCompletionAsync(projectId, repoPath, task.id).catch((err) => {
      log.warn("Post-completion async work failed", { taskId: task.id, err });
    });
  }

  private async postCompletionAsync(
    projectId: string,
    repoPath: string,
    taskId: string
  ): Promise<void> {
    if (!this.pushInProgress.has(projectId)) {
      let resolvePush!: () => void;
      const pushPromise = new Promise<void>((r) => {
        resolvePush = r;
      });
      this.pushCompletion.set(projectId, { promise: pushPromise, resolve: resolvePush });
      this.pushInProgress.add(projectId);
      try {
        await this.pushMainWithMergerFallback(projectId, repoPath);
      } finally {
        this.pushInProgress.delete(projectId);
        const entry = this.pushCompletion.get(projectId);
        if (entry) {
          entry.resolve();
          this.pushCompletion.delete(projectId);
        }
      }
    } else {
      log.info("Push already in progress, skipping (will retry on next completion)");
    }

    this.feedbackService.checkAutoResolveOnTaskDone(projectId, taskId).catch((err) => {
      log.warn("Auto-resolve feedback on task done failed", { taskId, err });
    });

    const epicId = extractEpicId(taskId);
    if (epicId) {
      const allIssues = await this.beads.listAll(repoPath);
      const implTasks = allIssues.filter(
        (i) =>
          i.id.startsWith(epicId + ".") &&
          !i.id.endsWith(".0") &&
          (i.issue_type ?? i.type) !== "epic"
      );
      const allClosed =
        implTasks.length > 0 && implTasks.every((i) => (i.status as string) === "closed");
      if (allClosed) {
        const settings = await this.projectService.getSettings(projectId);
        if (settings.deployment.autoDeployOnEpicCompletion) {
          triggerDeploy(projectId).catch((err) => {
            log.warn("Auto-deploy on epic completion failed", { projectId, err });
          });
        }
      }
    }
  }

  private async waitForPushComplete(projectId: string): Promise<void> {
    if (!this.pushInProgress.has(projectId)) return;
    const entry = this.pushCompletion.get(projectId);
    if (entry) await entry.promise;
  }

  private async pushMainWithMergerFallback(projectId: string, repoPath: string): Promise<void> {
    await gitCommitQueue.drain();

    try {
      await this.branchManager.pushMain(repoPath);
      eventLogService
        .append(repoPath, {
          timestamp: new Date().toISOString(),
          projectId,
          taskId: "",
          event: "push.succeeded",
        })
        .catch(() => {});
    } catch (err) {
      if (!(err instanceof RebaseConflictError)) {
        log.warn("pushMain failed (non-conflict)", { err });
        return;
      }

      if (err.conflictedFiles.length === 0) {
        const rebaseActive = await this.branchManager.isRebaseInProgress(repoPath);
        if (!rebaseActive) {
          log.info(
            "Rebase error with no conflicts and no rebase in progress, attempting direct push"
          );
          try {
            await this.branchManager.pushMainToOrigin(repoPath);
            log.info("Direct push succeeded after rebase error");
            await gitCommitQueue.retryPendingCommits(repoPath);
            return;
          } catch (pushErr) {
            log.warn("Direct push after rebase error failed", { pushErr });
            return;
          }
        }

        log.info("Rebase paused with no unmerged files, continuing directly");
        try {
          await this.branchManager.rebaseContinue(repoPath);
          await this.branchManager.pushMainToOrigin(repoPath);
          log.info("Auto-resolved rebase continued, push succeeded");
          await gitCommitQueue.retryPendingCommits(repoPath);
          return;
        } catch (contErr) {
          log.warn("rebaseContinue failed, falling through to merger agent", { contErr });
        }
      }

      log.info(`Rebase conflict in ${err.conflictedFiles.length} file(s), spawning merger agent`);

      try {
        const resolved = await this.spawnMergerAgent(projectId, repoPath, err.conflictedFiles);
        if (resolved) {
          await this.branchManager.pushMainToOrigin(repoPath);
          log.info("Merger agent resolved conflicts, push succeeded");
          await gitCommitQueue.retryPendingCommits(repoPath);
        } else {
          log.warn("Merger agent failed to resolve conflicts, aborting rebase");
          await this.branchManager.rebaseAbort(repoPath);
        }
      } catch (mergeErr) {
        log.warn("Merger agent error, aborting rebase", { mergeErr });
        await this.branchManager.rebaseAbort(repoPath);
      }
    }
  }

  private async spawnMergerAgent(
    projectId: string,
    repoPath: string,
    conflictedFiles: string[],
    mode: "rebase" | "merge" = "rebase"
  ): Promise<boolean> {
    const settings = await this.projectService.getSettings(projectId);
    const conflictDiff = await this.branchManager.getConflictDiff(repoPath);

    const prompt = this.contextAssembler.generateMergeConflictPrompt({
      conflictedFiles,
      conflictDiff,
      mode,
    });

    const mergerDir = path.join(repoPath, OPENSPRINT_PATHS.active, "_merger");
    await fs.mkdir(mergerDir, { recursive: true });
    const promptPath = path.join(mergerDir, "prompt.md");
    await fs.writeFile(promptPath, prompt);

    const resultPath = path.join(repoPath, ".opensprint", "merge-result.json");
    try {
      await fs.unlink(resultPath);
    } catch {
      // May not exist
    }

    const mergerId = `_merger:${projectId}`;
    const state = this.getState(projectId);

    return new Promise<boolean>((resolve) => {
      const mergerOutputLog: string[] = [];

      const handle = agentService.invokeMergerAgent(promptPath, settings.codingAgent, {
        cwd: repoPath,
        tracking: {
          id: mergerId,
          projectId,
          phase: "execute",
          role: "merger",
          label: "Resolving merge conflicts",
        },
        onOutput: (chunk: string) => {
          mergerOutputLog.push(chunk);
          sendAgentOutputToProject(projectId, "_merger", chunk);
        },
        onExit: async (code: number | null) => {
          state.globalTimers.clear("mergerTimeout");
          log.info("Merger agent exited", { code });

          await fs.rm(mergerDir, { recursive: true, force: true }).catch(() => {});

          const isRebase = mode === "rebase";
          const conflictStillActive = isRebase
            ? await this.branchManager.isRebaseInProgress(repoPath)
            : await this.branchManager.isMergeInProgress(repoPath);
          if (conflictStillActive) {
            resolve(false);
            return;
          }

          try {
            const raw = await fs.readFile(resultPath, "utf-8");
            const result = JSON.parse(raw) as { status: string; summary?: string };
            await fs.unlink(resultPath).catch(() => {});
            if (result.status === "success") {
              log.info("Merger agent", { summary: result.summary ?? "conflicts resolved" });
              resolve(true);
            } else {
              log.warn("Merger agent reported status", { status: result.status });
              resolve(false);
            }
            return;
          } catch {
            // No result file — fall back to exit code
          }

          resolve(code === 0 && !conflictStillActive);
        },
      });

      state.globalTimers.setTimeout(
        "mergerTimeout",
        () => {
          log.warn("Merger agent timed out after 5 minutes");
          handle.kill();
        },
        300_000
      );
    });
  }

  /**
   * Progressive backoff error handler with failure classification.
   */
  private async handleTaskFailure(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    branchName: string,
    reason: string,
    testResults?: TestResults | null,
    failureType: FailureType = "coding_failure",
    reviewFeedback?: string
  ): Promise<void> {
    const state = this.getState(projectId);
    const slot = state.slots.get(task.id);
    if (!slot) {
      log.warn("handleTaskFailure: no slot found for task", { taskId: task.id });
      return;
    }
    const cumulativeAttempts = slot.attempt;
    const wtPath = slot.worktreePath;
    const isInfraFailure = INFRA_FAILURE_TYPES.includes(failureType);

    log.error(`Task ${task.id} failed [${failureType}] (attempt ${cumulativeAttempts})`, {
      reason,
    });

    eventLogService
      .append(repoPath, {
        timestamp: new Date().toISOString(),
        projectId,
        taskId: task.id,
        event: `task.failed`,
        data: { failureType, attempt: cumulativeAttempts, reason: reason.slice(0, 500) },
      })
      .catch(() => {});

    const failSettings = await this.projectService.getSettings(projectId);
    agentIdentityService
      .recordAttempt(repoPath, {
        taskId: task.id,
        agentId: `${failSettings.codingAgent.type}-${failSettings.codingAgent.model ?? "default"}`,
        model: failSettings.codingAgent.model ?? "unknown",
        attempt: cumulativeAttempts,
        startedAt: slot.agent.startedAt,
        completedAt: new Date().toISOString(),
        outcome: failureType as AttemptOutcome,
        durationMs: Date.now() - new Date(slot.agent.startedAt || Date.now()).getTime(),
      })
      .catch((err) => log.warn("Failed to record attempt", { err }));

    let previousDiff = "";
    let gitDiff = "";
    try {
      const branchDiff = await this.branchManager.captureBranchDiff(repoPath, branchName);
      previousDiff = branchDiff;
      let uncommittedDiff = "";
      if (wtPath) {
        uncommittedDiff = await this.branchManager.captureUncommittedDiff(wtPath);
      }
      gitDiff = [branchDiff, uncommittedDiff]
        .filter(Boolean)
        .join("\n\n--- Uncommitted changes ---\n\n");
    } catch {
      // Branch may not exist
    }

    const session = await this.sessionManager.createSession(repoPath, {
      taskId: task.id,
      attempt: cumulativeAttempts,
      agentType: failSettings.codingAgent.type,
      agentModel: failSettings.codingAgent.model || "",
      gitBranch: branchName,
      status: "failed",
      outputLog: slot.agent.outputLog.join(""),
      failureReason: reason,
      testResults: testResults ?? undefined,
      gitDiff: gitDiff || undefined,
      startedAt: slot.agent.startedAt,
    });
    await this.sessionManager.archiveSession(
      repoPath,
      task.id,
      cumulativeAttempts,
      session,
      wtPath ?? undefined
    );

    const commentText =
      failureType === "review_rejection" && reviewFeedback
        ? `Review rejected (attempt ${cumulativeAttempts}):\n\n${reviewFeedback.slice(0, 2000)}`
        : `Attempt ${cumulativeAttempts} failed [${failureType}]: ${reason.slice(0, 500)}`;
    await this.beads
      .comment(repoPath, task.id, commentText)
      .catch((err) => log.warn("Failed to add failure comment", { err }));

    // Infrastructure failures get free retries
    if (isInfraFailure && slot.infraRetries < MAX_INFRA_RETRIES) {
      slot.infraRetries += 1;
      slot.attempt = cumulativeAttempts + 1;
      log.info(`Infrastructure retry ${slot.infraRetries}/${MAX_INFRA_RETRIES} for ${task.id}`, {
        failureType,
      });

      if (wtPath) {
        await this.branchManager.removeTaskWorktree(repoPath, task.id);
        slot.worktreePath = null;
      }

      await this.persistCounters(projectId, repoPath);
      await this.executeCodingPhase(projectId, repoPath, task, slot, {
        previousFailure: reason,
        reviewFeedback,
        useExistingBranch: true,
        previousDiff,
        previousTestOutput: slot.phaseResult.testOutput || undefined,
        failureType,
      });
      return;
    }

    if (!isInfraFailure) {
      slot.infraRetries = 0;
    }

    await this.beads.setCumulativeAttempts(repoPath, task.id, cumulativeAttempts);

    const isDemotionPoint = cumulativeAttempts % BACKOFF_FAILURE_THRESHOLD === 0;

    if (!isDemotionPoint) {
      // Immediate retry — keep the branch
      if (wtPath) {
        await this.branchManager.removeTaskWorktree(repoPath, task.id);
        slot.worktreePath = null;
      }

      slot.attempt = cumulativeAttempts + 1;
      log.info(`Retrying ${task.id} (attempt ${slot.attempt}), preserving branch`);

      await this.persistCounters(projectId, repoPath);

      await this.executeCodingPhase(projectId, repoPath, task, slot, {
        previousFailure: reason,
        reviewFeedback,
        useExistingBranch: true,
        previousDiff,
        previousTestOutput: slot.phaseResult.testOutput || undefined,
        failureType,
      });
    } else {
      // Demotion point: clean slate — remove slot, delete branch
      if (wtPath) {
        await this.branchManager.removeTaskWorktree(repoPath, task.id);
      }
      await this.branchManager.deleteBranch(repoPath, branchName);
      await this.deleteAssignment(repoPath, task.id);

      const currentPriority = task.priority ?? 2;

      if (currentPriority >= MAX_PRIORITY_BEFORE_BLOCK) {
        await this.blockTask(projectId, repoPath, task, cumulativeAttempts, reason);
      } else {
        const newPriority = currentPriority + 1;
        log.info(
          `Demoting ${task.id} priority ${currentPriority} → ${newPriority} after ${cumulativeAttempts} failures`
        );

        try {
          await this.beads.update(repoPath, task.id, {
            status: "open",
            assignee: "",
            priority: newPriority,
          });
        } catch {
          // Task may already be in the right state
        }

        this.transition(projectId, { to: "fail", taskId: task.id });
        await this.persistCounters(projectId, repoPath);

        broadcastToProject(projectId, {
          type: "task.updated",
          taskId: task.id,
          status: "open",
          assignee: null,
        });
        broadcastToProject(projectId, {
          type: "agent.completed",
          taskId: task.id,
          status: "failed",
          testResults: null,
        });

        // Nudge to fill the freed slot
        this.nudge(projectId);
      }
    }
  }

  // ─── Helpers ───

  private async runSummarizer(
    projectId: string,
    settings: { planningAgent: AgentConfig },
    taskId: string,
    context: TaskContext
  ): Promise<TaskContext> {
    const depCount = context.dependencyOutputs.length;
    const planWordCount = countWords(context.planContent);
    const summarizerPrompt = buildSummarizerPrompt(taskId, context, depCount, planWordCount);
    const systemPrompt = `You are the Summarizer agent for OpenSprint (PRD §12.3.5). Condense context into a focused summary when it exceeds size thresholds. Produce JSON only. No markdown outside the summary field.`;
    const summarizerId = `summarizer-${projectId}-${taskId}-${Date.now()}`;

    try {
      const summarizerResponse = await agentService.invokePlanningAgent({
        config: settings.planningAgent,
        messages: [{ role: "user", content: summarizerPrompt }],
        systemPrompt,
        tracking: {
          id: summarizerId,
          projectId,
          phase: "execute",
          role: "summarizer",
          label: "Context condensation",
        },
      });

      const parsed = extractJsonFromAgentResponse<{ status: string; summary?: string }>(
        summarizerResponse.content,
        "status"
      );
      if (parsed && parsed.status === "success" && parsed.summary?.trim()) {
        log.info("Summarizer condensed context for task", { taskId });
        return {
          ...context,
          planContent: parsed.summary.trim(),
          prdExcerpt:
            "Context condensed by Summarizer (thresholds exceeded). See plan.md for full context.",
          dependencyOutputs: [],
        };
      }
    } catch (err) {
      log.warn("Summarizer failed, using raw context", {
        taskId,
        err: getErrorMessage(err),
      });
    }
    return context;
  }

  private async preflightCheck(repoPath: string, wtPath: string, taskId: string): Promise<void> {
    await this.branchManager.waitForGitReady(wtPath);

    try {
      await fs.access(path.join(wtPath, "node_modules"));
    } catch {
      log.warn("Pre-flight: node_modules missing, re-symlinking");
      await this.branchManager.symlinkNodeModules(repoPath, wtPath);
    }

    await this.sessionManager.clearResult(wtPath, taskId);
  }

  private async blockTask(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    cumulativeAttempts: number,
    reason: string
  ): Promise<void> {
    log.info(`Blocking ${task.id} after ${cumulativeAttempts} cumulative failures at max priority`);

    try {
      await this.beads.update(repoPath, task.id, {
        status: "blocked",
        assignee: "",
      });
    } catch (err) {
      log.warn("Failed to block task", { err });
    }

    this.transition(projectId, { to: "fail", taskId: task.id });
    await this.persistCounters(projectId, repoPath);

    broadcastToProject(projectId, {
      type: "task.blocked",
      taskId: task.id,
      reason: `Blocked after ${cumulativeAttempts} failed attempts: ${reason.slice(0, 300)}`,
      cumulativeAttempts,
    });
    broadcastToProject(projectId, {
      type: "task.updated",
      taskId: task.id,
      status: "blocked",
      assignee: null,
    });
    broadcastToProject(projectId, {
      type: "agent.completed",
      taskId: task.id,
      status: "failed",
      testResults: null,
    });

    // Nudge to fill the freed slot
    this.nudge(projectId);
  }
}

/** Shared orchestrator instance for build routes and task list (kanban phase override) */
export const orchestratorService = new OrchestratorService();
