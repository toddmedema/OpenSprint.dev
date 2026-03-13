/**
 * SelfImprovementService — orchestrates self-improvement runs: change detection,
 * single run per project (delegated to runner), and invoking the review path.
 * Runs change detection (hasCodeChangesSince) before triggering; if repo unchanged, returns without running.
 */

import { ProjectService } from "./project.service.js";
import { getMergeQualityGateCommands } from "./merge-quality-gates.js";
import { hasCodeChangesSince } from "./self-improvement-change-detection.js";
import {
  runSelfImprovement,
  type RunSelfImprovementOptions,
  type RunSelfImprovementResult,
} from "./self-improvement-runner.service.js";
import { taskStore } from "./task-store.service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("self-improvement");
const BASELINE_QUALITY_GATE_TASK_SOURCE = "merge-quality-gate-baseline";
const BASELINE_QUALITY_GATE_TASK_COMPLEXITY = 6;
const BASELINE_QUALITY_GATE_REASON_LIMIT = 1200;
const BASELINE_QUALITY_GATE_OUTPUT_LIMIT = 2400;

/** Result of SelfImprovementService.run: success, skipped (in progress), or skipped (no changes). */
export type SelfImprovementRunResult =
  | RunSelfImprovementResult
  | { tasksCreated: 0; skipped: "no_changes" };

/** Trigger for runIfDue: scheduled (daily/weekly tick) or after plan execution. */
export type SelfImprovementTrigger = "scheduled" | "after_each_plan";

/** Options for runIfDue: trigger and context (e.g. planId when trigger is after_each_plan). */
export type RunIfDueOptions =
  | { trigger: "after_each_plan"; planId: string }
  | { trigger: "scheduled" };

export interface BaselineQualityGateTaskInput {
  baseBranch: string;
  command: string;
  reason: string;
  outputSnippet?: string | null;
  worktreePath?: string | null;
}

function truncateText(value: string | null | undefined, maxLen: number): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen).trimEnd()}...`;
}

/**
 * Self-improvement service: one run per project (in runner), change detection before run,
 * then delegates to runner for context build, Reviewer (or equivalent) invocation, parse, and task creation.
 */
export class SelfImprovementService {
  private projectService = new ProjectService();

  private buildBaselineQualityGateTaskTitle(baseBranch: string): string {
    return `Restore baseline quality gates on ${baseBranch}`;
  }

  private buildBaselineQualityGateTaskDescription(input: BaselineQualityGateTaskInput): string {
    const commands = getMergeQualityGateCommands();
    const reason =
      truncateText(input.reason, BASELINE_QUALITY_GATE_REASON_LIMIT) || "Unknown failure";
    const outputSnippet = truncateText(input.outputSnippet, BASELINE_QUALITY_GATE_OUTPUT_LIMIT);
    const lines = [
      `Open Sprint detected that the baseline merge quality gates on \`${input.baseBranch}\` are failing, but allowed task merges to continue.`,
      "",
      "Restore the baseline quickly so merges back to main stay trustworthy.",
      "",
      `Failed command: \`${input.command}\``,
      `Base branch: \`${input.baseBranch}\``,
      `Expected passing commands: ${commands.map((command) => `\`${command}\``).join(", ")}`,
      ...(input.worktreePath ? [`Worktree path: \`${input.worktreePath}\``] : []),
      "",
      "Failure reason:",
      "```",
      reason,
      "```",
      ...(outputSnippet ? ["", "Latest output snippet:", "```", outputSnippet, "```"] : []),
    ];
    return lines.join("\n");
  }

  async ensureBaselineQualityGateTask(
    projectId: string,
    input: BaselineQualityGateTaskInput
  ): Promise<{ taskId: string; created: boolean }> {
    const title = this.buildBaselineQualityGateTaskTitle(input.baseBranch);
    const description = this.buildBaselineQualityGateTaskDescription(input);
    const reason = truncateText(input.reason, BASELINE_QUALITY_GATE_REASON_LIMIT);
    const outputSnippet = truncateText(input.outputSnippet, BASELINE_QUALITY_GATE_OUTPUT_LIMIT);
    const extra = {
      source: "self-improvement",
      selfImprovementKind: "baseline-quality-gate",
      baselineQualityGateSource: BASELINE_QUALITY_GATE_TASK_SOURCE,
      baselineBaseBranch: input.baseBranch,
      failedGateCommand: input.command,
      failedGateReason: reason,
      failedGateOutputSnippet: outputSnippet,
      worktreePath: input.worktreePath ?? null,
      baselineQualityGateCommands: getMergeQualityGateCommands(),
    };

    const allTasks = await taskStore.listAll(projectId);
    const existing = allTasks.find((task) => {
      const status = (task.status as string) ?? "open";
      if (status === "closed") return false;
      const source = (task as { source?: unknown }).source;
      const kind = (task as { selfImprovementKind?: unknown }).selfImprovementKind;
      const sourceId = (task as { baselineQualityGateSource?: unknown }).baselineQualityGateSource;
      const baseBranch = (task as { baselineBaseBranch?: unknown }).baselineBaseBranch;
      return (
        source === "self-improvement" &&
        (kind === "baseline-quality-gate" || sourceId === BASELINE_QUALITY_GATE_TASK_SOURCE) &&
        baseBranch === input.baseBranch
      );
    });

    if (existing) {
      await taskStore.update(projectId, existing.id, {
        title,
        description,
        priority: 0,
        complexity: BASELINE_QUALITY_GATE_TASK_COMPLEXITY,
        extra,
      });
      return { taskId: existing.id, created: false };
    }

    const created = await taskStore.create(projectId, title, {
      type: "bug",
      priority: 0,
      description,
      complexity: BASELINE_QUALITY_GATE_TASK_COMPLEXITY,
      extra,
    });
    log.info("Created self-improvement task for baseline quality-gate failure", {
      projectId,
      taskId: created.id,
      baseBranch: input.baseBranch,
      command: input.command,
    });
    return { taskId: created.id, created: true };
  }

  /**
   * Run self-improvement if the trigger matches project frequency, then run change detection and flow.
   * For trigger 'scheduled': only runs when settings.selfImprovementFrequency is 'daily' or 'weekly'.
   * For trigger 'after_each_plan': only runs when frequency is 'after_each_plan'.
   * Otherwise returns without running.
   */
  async runIfDue(
    projectId: string,
    options: RunIfDueOptions
  ): Promise<SelfImprovementRunResult | { tasksCreated: 0; skipped: "frequency_not_due" }> {
    const settings = await this.projectService.getSettings(projectId);
    const freq = settings.selfImprovementFrequency ?? "never";

    if (options.trigger === "scheduled") {
      if (freq !== "daily" && freq !== "weekly") return { tasksCreated: 0, skipped: "no_changes" };
      return this.run(projectId, { trigger: "scheduled" });
    }
    if (options.trigger === "after_each_plan") {
      if (freq !== "after_each_plan") {
        log.debug("Self-improvement skipped: frequency not after_each_plan", {
          projectId,
          frequency: freq,
        });
        return { tasksCreated: 0, skipped: "frequency_not_due" };
      }
      return this.run(projectId, { planId: options.planId });
    }
    return { tasksCreated: 0, skipped: "no_changes" };
  }

  /**
   * Run self-improvement for a project if the repo has changed since last run.
   * (1) Only one run per project at a time (enforced by runner).
   * (2) Change detection: if unchanged, return without running.
   * (3) Runner builds context, invokes Reviewer (or equivalent), parses output, creates tasks, updates lastRun.
   * On Reviewer failure/timeout the runner does not update lastRunAt.
   */
  async run(
    projectId: string,
    options?: RunSelfImprovementOptions
  ): Promise<SelfImprovementRunResult> {
    const project = await this.projectService.getProject(projectId);
    const settings = await this.projectService.getSettings(projectId);
    const repoPath = project.repoPath;
    const lastRunAt = settings.selfImprovementLastRunAt;
    const lastSha = settings.selfImprovementLastCommitSha;
    const baseBranch = settings.worktreeBaseBranch;

    const hasChanged = await hasCodeChangesSince(repoPath, {
      sinceTimestamp: lastRunAt,
      sinceCommitSha: lastSha,
      baseBranch: baseBranch ?? undefined,
    });

    if (!hasChanged) {
      log.debug("Self-improvement skipped: no changes since last run", {
        projectId,
        lastRunAt: lastRunAt ?? "(none)",
      });
      return { tasksCreated: 0, skipped: "no_changes" };
    }

    return runSelfImprovement(projectId, options);
  }
}

export const selfImprovementService = new SelfImprovementService();
