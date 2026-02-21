/**
 * PhaseExecutor — executes coding and review phases.
 * Extracted from OrchestratorService for clarity and testability.
 */

import fs from "fs/promises";
import path from "path";
import type { ActiveTaskConfig } from "@opensprint/shared";
import { OPENSPRINT_PATHS, resolveTestCommand, getCodingAgentForComplexity } from "@opensprint/shared";
import type { BeadsIssue } from "./beads.service.js";
import type { BranchManager } from "./branch-manager.js";
import type { ContextAssembler } from "./context-assembler.js";
import type { SessionManager } from "./session-manager.js";
import type { TestRunner } from "./test-runner.js";
import type { AgentLifecycleManager } from "./agent-lifecycle.js";
import type { TaskContext } from "./context-assembler.js";
import { shouldInvokeSummarizer } from "./summarizer.service.js";
import { getPlanComplexityForTask } from "./plan-complexity.js";
import { agentIdentityService } from "./agent-identity.service.js";
import { eventLogService } from "./event-log.service.js";
import { writeJsonAtomic } from "../utils/file-utils.js";
import type {
  AgentSlotLike,
  PhaseExecutorCallbacks,
  RetryContext,
  TaskAssignmentLike,
} from "./orchestrator-phase-context.js";
import type { AgentRunState } from "./agent-lifecycle.js";
import type { TimerRegistry } from "./timer-registry.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("phase-executor");

export interface PhaseExecutorHost {
  getState(projectId: string): { slots: Map<string, { agent: AgentRunState; timers: TimerRegistry } & AgentSlotLike>; status: { queueDepth: number } };
  beads: import("./beads.service.js").BeadsService;
  projectService: import("./project.service.js").ProjectService;
  branchManager: BranchManager;
  contextAssembler: ContextAssembler;
  sessionManager: SessionManager;
  testRunner: TestRunner;
  lifecycleManager: AgentLifecycleManager;
  persistCounters(projectId: string, repoPath: string): Promise<void>;
  preflightCheck(repoPath: string, wtPath: string, taskId: string): Promise<void>;
  runSummarizer(
    projectId: string,
    settings: { planningAgent: import("@opensprint/shared").AgentConfig },
    taskId: string,
    context: TaskContext
  ): Promise<TaskContext>;
  getCachedSummarizerContext(projectId: string, taskId: string): TaskContext | undefined;
  setCachedSummarizerContext(projectId: string, taskId: string, context: TaskContext): void;
  buildReviewHistory(repoPath: string, taskId: string): Promise<string>;
}

export class PhaseExecutorService {
  constructor(
    private host: PhaseExecutorHost,
    private callbacks: PhaseExecutorCallbacks
  ) {}

  async executeCodingPhase(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    slot: AgentSlotLike & { agent: AgentRunState; timers: TimerRegistry },
    retryContext?: RetryContext
  ): Promise<void> {
    const settings = await this.host.projectService.getSettings(projectId);
    const branchName = slot.branchName;

    try {
      const wtPath = await this.host.branchManager.createTaskWorktree(repoPath, task.id);
      (slot as { worktreePath: string | null }).worktreePath = wtPath;

      await this.host.preflightCheck(repoPath, wtPath, task.id);

      let context: TaskContext = await this.host.contextAssembler.buildContext(
        repoPath,
        task.id,
        this.host.beads,
        this.host.branchManager,
        { task }
      );

      if (shouldInvokeSummarizer(context)) {
        const cached = retryContext && this.host.getCachedSummarizerContext(projectId, task.id);
        if (cached) {
          context = cached;
          log.info("Using cached Summarizer context for retry", { taskId: task.id });
        } else {
          context = await this.host.runSummarizer(projectId, settings, task.id, context);
          this.host.setCachedSummarizerContext(projectId, task.id, context);
        }
      }

      const config: ActiveTaskConfig = {
        invocation_id: task.id,
        agent_role: "coder",
        taskId: task.id,
        repoPath: wtPath,
        branch: branchName,
        testCommand: resolveTestCommand(settings) || 'echo "No test command configured"',
        attempt: slot.attempt,
        phase: "coding",
        previousFailure: retryContext?.previousFailure ?? null,
        reviewFeedback: retryContext?.reviewFeedback ?? null,
        previousTestOutput: retryContext?.previousTestOutput ?? null,
        previousDiff: retryContext?.previousDiff ?? null,
        useExistingBranch: retryContext?.useExistingBranch ?? false,
      };

      await this.host.contextAssembler.assembleTaskDirectory(wtPath, task.id, config, context);

      const taskDir = this.host.sessionManager.getActiveDir(wtPath, task.id);
      const promptPath = path.join(taskDir, "prompt.md");

      const complexity = await getPlanComplexityForTask(repoPath, task);
      let agentConfig = getCodingAgentForComplexity(settings, complexity);

      if (retryContext?.failureType && slot.attempt > 1) {
        const recentAttempts = await agentIdentityService.getRecentAttempts(repoPath, task.id);
        agentConfig = agentIdentityService.selectAgentForRetry(
          settings,
          task.id,
          slot.attempt,
          retryContext.failureType,
          complexity,
          recentAttempts
        );
      }

      const assignment: TaskAssignmentLike = {
        taskId: task.id,
        projectId,
        phase: "coding",
        branchName,
        worktreePath: wtPath,
        promptPath,
        agentConfig,
        attempt: slot.attempt,
        retryContext,
        createdAt: new Date().toISOString(),
      };
      await writeJsonAtomic(path.join(taskDir, OPENSPRINT_PATHS.assignment), assignment);

      this.host.lifecycleManager.run(
        {
          projectId,
          taskId: task.id,
          phase: "coding",
          wtPath,
          branchName,
          promptPath,
          agentConfig,
          agentLabel: slot.taskTitle ?? task.id,
          role: "coder",
          onDone: (code) => this.callbacks.handleCodingDone(projectId, repoPath, task, branchName, code),
        },
        slot.agent,
        slot.timers
      );

      eventLogService
        .append(repoPath, {
          timestamp: new Date().toISOString(),
          projectId,
          taskId: task.id,
          event: "agent.spawned",
          data: { phase: "coding", model: agentConfig.model, attempt: slot.attempt },
        })
        .catch(() => {});

      await this.host.persistCounters(projectId, repoPath);
    } catch (error) {
      log.error(`Coding phase failed for task ${task.id}`, { error });
      await this.callbacks.handleTaskFailure(
        projectId,
        repoPath,
        task,
        branchName,
        String(error),
        null,
        "agent_crash"
      );
    }
  }

  async executeReviewPhase(
    projectId: string,
    repoPath: string,
    task: BeadsIssue,
    branchName: string
  ): Promise<void> {
    const state = this.host.getState(projectId);
    const slot = state.slots.get(task.id);
    if (!slot) {
      log.warn("executeReviewPhase: no slot found for task", { taskId: task.id });
      return;
    }
    const settings = await this.host.projectService.getSettings(projectId);
    const wtPath = slot.worktreePath ?? repoPath;

    try {
      const config: ActiveTaskConfig = {
        invocation_id: task.id,
        agent_role: "reviewer",
        taskId: task.id,
        repoPath: wtPath,
        branch: branchName,
        testCommand: resolveTestCommand(settings) || 'echo "No test command configured"',
        attempt: slot.attempt,
        phase: "review",
        previousFailure: null,
        reviewFeedback: null,
      };

      const taskDir = this.host.sessionManager.getActiveDir(wtPath, task.id);
      await fs.mkdir(taskDir, { recursive: true });
      await fs.writeFile(path.join(taskDir, "config.json"), JSON.stringify(config, null, 2));

      const context = await this.host.contextAssembler.buildContext(
        repoPath,
        task.id,
        this.host.beads,
        this.host.branchManager,
        { task }
      );

      context.reviewHistory = await this.host.buildReviewHistory(repoPath, task.id);

      await this.host.contextAssembler.assembleTaskDirectory(wtPath, task.id, config, context);

      const promptPath = path.join(taskDir, "prompt.md");

      const complexity = await getPlanComplexityForTask(repoPath, task);
      const agentConfig = getCodingAgentForComplexity(settings, complexity);

      const assignment: TaskAssignmentLike = {
        taskId: task.id,
        projectId,
        phase: "review",
        branchName,
        worktreePath: wtPath,
        promptPath,
        agentConfig,
        attempt: slot.attempt,
        createdAt: new Date().toISOString(),
      };
      await writeJsonAtomic(path.join(taskDir, OPENSPRINT_PATHS.assignment), assignment);

      this.host.lifecycleManager.run(
        {
          projectId,
          taskId: task.id,
          phase: "review",
          wtPath,
          branchName,
          promptPath,
          agentConfig,
          agentLabel: slot.taskTitle ?? task.id,
          role: "reviewer",
          onDone: (code) => this.callbacks.handleReviewDone(projectId, repoPath, task, branchName, code),
        },
        slot.agent,
        slot.timers
      );

      eventLogService
        .append(repoPath, {
          timestamp: new Date().toISOString(),
          projectId,
          taskId: task.id,
          event: "agent.spawned",
          data: { phase: "review", model: agentConfig.model, attempt: slot.attempt },
        })
        .catch(() => {});

      await this.host.persistCounters(projectId, repoPath);
    } catch (error) {
      log.error(`Review phase failed for task ${task.id}`, { error });
      await this.callbacks.handleTaskFailure(
        projectId,
        repoPath,
        task,
        branchName,
        String(error),
        null,
        "agent_crash"
      );
    }
  }
}
