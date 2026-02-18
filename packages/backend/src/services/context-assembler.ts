import fs from "fs/promises";
import path from "path";
import { OPENSPRINT_PATHS } from "@opensprint/shared";
import type { ActiveTaskConfig } from "@opensprint/shared";
import { BranchManager } from "./branch-manager.js";
import type { BeadsService } from "./beads.service.js";
import type { BeadsIssue } from "./beads.service.js";

export interface TaskContext {
  taskId: string;
  title: string;
  description: string;
  planContent: string;
  prdExcerpt: string;
  dependencyOutputs: Array<{ taskId: string; diff: string; summary: string }>;
}

/**
 * Assembles context for agent prompts:
 * - Extracts relevant PRD sections
 * - Reads the parent Plan markdown
 * - Collects diffs/summaries from completed dependency tasks
 * - Generates prompt.md per the coding/review templates
 */
export class ContextAssembler {
  private branchManager = new BranchManager();

  /**
   * Set up the task directory with all necessary context files.
   */
  async assembleTaskDirectory(
    repoPath: string,
    taskId: string,
    config: ActiveTaskConfig,
    context: TaskContext
  ): Promise<string> {
    const taskDir = path.join(repoPath, OPENSPRINT_PATHS.active, taskId);
    const contextDir = path.join(taskDir, "context");
    const depsDir = path.join(contextDir, "deps");

    await fs.mkdir(depsDir, { recursive: true });

    // Write config.json
    await fs.writeFile(path.join(taskDir, "config.json"), JSON.stringify(config, null, 2));

    // Write context files
    await fs.writeFile(path.join(contextDir, "prd_excerpt.md"), context.prdExcerpt);

    await fs.writeFile(path.join(contextDir, "plan.md"), context.planContent);

    // Write dependency outputs
    for (const dep of context.dependencyOutputs) {
      await fs.writeFile(path.join(depsDir, `${dep.taskId}.diff`), dep.diff);
      await fs.writeFile(path.join(depsDir, `${dep.taskId}.summary.md`), dep.summary);
    }

    // Generate prompt.md
    const prompt =
      config.phase === "coding"
        ? this.generateCodingPrompt(config, context)
        : this.generateReviewPrompt(config, context);

    await fs.writeFile(path.join(taskDir, "prompt.md"), prompt);

    return taskDir;
  }

  /**
   * Read the PRD and extract relevant sections.
   */
  async extractPrdExcerpt(repoPath: string): Promise<string> {
    try {
      const prdPath = path.join(repoPath, OPENSPRINT_PATHS.prd);
      const raw = await fs.readFile(prdPath, "utf-8");
      const prd = JSON.parse(raw);

      let excerpt = "# Product Requirements (Excerpt)\n\n";
      for (const [key, section] of Object.entries(prd.sections || {})) {
        const sec = section as { content: string };
        if (sec.content) {
          excerpt += `## ${key.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}\n\n`;
          excerpt += sec.content + "\n\n";
        }
      }
      return excerpt;
    } catch {
      return "# Product Requirements\n\nNo PRD available.";
    }
  }

  /**
   * Read a Plan markdown file.
   */
  async readPlanContent(repoPath: string, planId: string): Promise<string> {
    try {
      const planPath = path.join(repoPath, OPENSPRINT_PATHS.plans, `${planId}.md`);
      return await fs.readFile(planPath, "utf-8");
    } catch {
      return "# Plan\n\nNo plan content available.";
    }
  }

  /**
   * Get plan content for a task by resolving its parent epic's plan path.
   * Returns empty string if the task has no parent or the parent has no plan path.
   */
  async getPlanContentForTask(
    repoPath: string,
    task: BeadsIssue,
    beads: BeadsService
  ): Promise<string> {
    const parentId = beads.getParentId(task.id);
    if (parentId) {
      try {
        const parent = await beads.show(repoPath, parentId);
        const desc = parent.description as string;
        if (desc?.startsWith(".opensprint/plans/")) {
          const planId = path.basename(desc, ".md");
          return this.readPlanContent(repoPath, planId);
        }
      } catch {
        // Parent might not exist
      }
    }
    return "";
  }

  /**
   * Build full context for a task given only taskId (ContextBuilder per feature decomposition).
   * - Gets Plan path from epic description, reads Plan markdown
   * - Extracts relevant PRD sections
   * - For each dependency task: gets git diff (main...branch) if branch exists, else uses archived session
   */
  async buildContext(
    repoPath: string,
    taskId: string,
    beads: BeadsService,
    branchManager: BranchManager
  ): Promise<TaskContext> {
    const task = await beads.show(repoPath, taskId);
    const title = task.title ?? "";
    const description = (task.description as string) ?? "";

    const planContent =
      (await this.getPlanContentForTask(repoPath, task, beads)) ||
      "# Plan\n\nNo plan content available.";

    const prdExcerpt = await this.extractPrdExcerpt(repoPath);
    const dependencyTaskIds = await beads.getBlockers(repoPath, taskId);
    const dependencyOutputs = await this.collectDependencyOutputsWithGitDiff(
      repoPath,
      dependencyTaskIds,
      branchManager
    );

    return {
      taskId,
      title,
      description,
      planContent,
      prdExcerpt,
      dependencyOutputs,
    };
  }

  /**
   * Collect diffs/summaries from dependency tasks.
   * For each dep: try git diff main...branch first; if branch doesn't exist (merged/deleted), use archived session.
   */
  private async collectDependencyOutputsWithGitDiff(
    repoPath: string,
    dependencyTaskIds: string[],
    branchManager: BranchManager
  ): Promise<Array<{ taskId: string; diff: string; summary: string }>> {
    const outputs: Array<{ taskId: string; diff: string; summary: string }> = [];

    for (const depId of dependencyTaskIds) {
      const branchName = `opensprint/${depId}`;
      let diff = "";
      let summary = `Task ${depId} completed.`;

      // Try git diff first (branch exists if dep is in progress or in review)
      try {
        diff = await branchManager.getDiff(repoPath, branchName);
      } catch {
        // Branch merged/deleted — fall back to archived session
      }

      // If no diff from git, use session archive
      if (!diff) {
        const fromSession = await this.collectDependencyOutputs(repoPath, [depId]);
        if (fromSession.length > 0) {
          diff = fromSession[0].diff;
          summary = fromSession[0].summary;
        }
      }

      outputs.push({ taskId: depId, diff, summary });
    }

    return outputs;
  }

  /**
   * Extract a markdown section by heading (e.g. "Acceptance Criteria", "Technical Approach").
   * Returns content between ## Section and the next ## or end of document.
   */
  private extractPlanSection(planContent: string, sectionName: string): string {
    const heading = `## ${sectionName}`;
    const idx = planContent.indexOf(heading);
    if (idx === -1) return "";

    const start = idx + heading.length;
    const rest = planContent.slice(start);
    const nextHeading = rest.match(/\n##\s+/);
    const end = nextHeading ? nextHeading.index! : rest.length;
    return rest.slice(0, end).trim();
  }

  /**
   * Collect diffs/summaries from completed dependency tasks for context assembly (PRD §7.3.2).
   * Only uses approved sessions (tasks that reached Done); skips gating tasks and failed attempts.
   * Sessions are stored at .opensprint/sessions/<task-id>-<attempt>/session.json
   */
  async collectDependencyOutputs(
    repoPath: string,
    dependencyTaskIds: string[]
  ): Promise<Array<{ taskId: string; diff: string; summary: string }>> {
    const outputs: Array<{ taskId: string; diff: string; summary: string }> = [];

    for (const depId of dependencyTaskIds) {
      try {
        const sessionsDir = path.join(repoPath, OPENSPRINT_PATHS.sessions);
        const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
        const sessionDirs = entries
          .filter((e) => e.isDirectory() && e.name.startsWith(depId + "-"))
          .map((e) => e.name)
          .sort((a, b) => {
            const attemptA = parseInt(a.slice((depId + "-").length) || "0", 10);
            const attemptB = parseInt(b.slice((depId + "-").length) || "0", 10);
            return attemptB - attemptA;
          });

        // Find the latest approved session (completed task output)
        for (const dir of sessionDirs) {
          const sessionPath = path.join(sessionsDir, dir, "session.json");
          const raw = await fs.readFile(sessionPath, "utf-8");
          const session = JSON.parse(raw) as {
            gitDiff?: string;
            summary?: string;
            status?: string;
          };
          if (session.status === "approved") {
            outputs.push({
              taskId: depId,
              diff: session.gitDiff || "",
              summary: session.summary || `Task ${depId} completed.`,
            });
            break;
          }
        }
      } catch {
        // Skip if we can't read dependency output
      }
    }

    return outputs;
  }

  private generateCodingPrompt(config: ActiveTaskConfig, context: TaskContext): string {
    let prompt = `# Task: ${context.title}\n\n`;
    prompt += `## Objective\n\n${context.description}\n\n`;
    prompt += `## Context\n\n`;
    prompt += `You are implementing a task as part of a larger feature. Review the provided context files:\n\n`;
    prompt += `- \`context/plan.md\` — the full feature specification\n`;
    prompt += `- \`context/prd_excerpt.md\` — relevant product requirements\n`;
    prompt += `- \`context/deps/\` — output from tasks this depends on\n\n`;

    const acceptanceCriteria = this.extractPlanSection(context.planContent, "Acceptance Criteria");
    if (acceptanceCriteria) {
      prompt += `## Acceptance Criteria\n\n${acceptanceCriteria}\n\n`;
    }

    const technicalApproach = this.extractPlanSection(context.planContent, "Technical Approach");
    if (technicalApproach) {
      prompt += `## Technical Approach\n\n${technicalApproach}\n\n`;
    }

    prompt += `## Instructions\n\n`;
    prompt += `1. Work on branch \`${config.branch}\` (already checked out in this worktree).\n`;

    if (config.useExistingBranch) {
      prompt += `2. **This branch contains work from a previous attempt.** Review the existing code before making changes. Build on what's already there rather than starting from scratch.\n`;
      prompt += `3. Implement or fix the task according to the acceptance criteria.\n`;
    } else {
      prompt += `2. Implement the task according to the acceptance criteria.\n`;
    }

    prompt += `${config.useExistingBranch ? "4" : "3"}. Write comprehensive tests (unit, and integration where applicable).\n`;
    prompt += `${config.useExistingBranch ? "5" : "4"}. **Commit after each meaningful change** — with descriptive WIP messages. Do not wait until the end to commit. (e.g., after implementing a function, after writing its tests). This protects your work if the process is interrupted.\n`;
    prompt += `${config.useExistingBranch ? "6" : "5"}. Run \`${config.testCommand}\` and ensure all tests pass.\n`;
    prompt += `${config.useExistingBranch ? "7" : "6"}. Write your result to \`.opensprint/active/${config.taskId}/result.json\` using this exact JSON format:\n`;
    prompt += `   \`\`\`json\n`;
    prompt += `   { "status": "success", "summary": "Brief description of what you implemented" }\n`;
    prompt += `   \`\`\`\n`;
    prompt += `   Use \`"status": "success"\` when the task is done, or \`"status": "failed"\` if you could not finish it.\n`;
    prompt += `   The \`status\` field MUST be exactly \`"success"\` or \`"failed"\` — no other values.\n\n`;

    if (config.previousFailure) {
      prompt += `## Previous Attempt\n\n`;
      prompt += `This is attempt ${config.attempt}. The previous attempt failed:\n${config.previousFailure}\n\n`;

      if (config.previousTestOutput) {
        prompt += `### Test Output\n\n\`\`\`\n${config.previousTestOutput.slice(0, 5000)}\n\`\`\`\n\n`;
        prompt += `Fix the failing tests without breaking the passing ones.\n\n`;
      }
    }

    if (config.reviewFeedback) {
      prompt += `## Review Feedback\n\n`;
      prompt += `The review agent rejected the previous implementation:\n${config.reviewFeedback}\n\n`;
    }

    return prompt;
  }

  /**
   * Generate a prompt for the Merger agent to resolve rebase conflicts.
   * This is a standalone prompt (not tied to ActiveTaskConfig) since merge
   * conflicts happen outside the normal task lifecycle.
   */
  generateMergeConflictPrompt(opts: { conflictedFiles: string[]; conflictDiff: string }): string {
    let prompt = `# Resolve Rebase Conflicts\n\n`;
    prompt += `## Situation\n\n`;
    prompt += `The orchestrator merged a task branch into local \`main\`, then ran \`git rebase origin/main\` `;
    prompt += `to incorporate remote changes before pushing. The rebase hit conflicts that need manual resolution.\n\n`;
    prompt += `The repository is currently in a **rebase-in-progress** state. Your job is to resolve all conflicts `;
    prompt += `and allow the rebase to complete.\n\n`;

    prompt += `## Conflicted Files\n\n`;
    for (const f of opts.conflictedFiles) {
      prompt += `- \`${f}\`\n`;
    }
    prompt += `\n`;

    if (opts.conflictDiff) {
      const truncated = opts.conflictDiff.slice(0, 20_000);
      prompt += `## Conflict Diff\n\n\`\`\`diff\n${truncated}\n\`\`\`\n\n`;
      if (opts.conflictDiff.length > 20_000) {
        prompt += `*(diff truncated — run \`git diff\` to see the full output)*\n\n`;
      }
    }

    prompt += `## Instructions\n\n`;
    prompt += `1. For each conflicted file, open it, understand both sides, and resolve the conflict markers (\`<<<<<<<\`, \`=======\`, \`>>>>>>>\`). Keep the correct combination of both sides.\n`;
    prompt += `2. After resolving each file, stage it with \`git add <file>\`.\n`;
    prompt += `3. Once ALL conflicts are resolved and staged, run: \`git -c core.editor=true rebase --continue\`\n`;
    prompt += `4. Verify the rebase completed successfully (no more conflicts).\n`;
    prompt += `5. Write your result to \`.opensprint/merge-result.json\` using this exact JSON format:\n`;
    prompt += `   \`\`\`json\n`;
    prompt += `   { "status": "success", "summary": "Brief description of how conflicts were resolved" }\n`;
    prompt += `   \`\`\`\n`;
    prompt += `   Use \`"status": "success"\` when all conflicts are resolved and the rebase completed.\n`;
    prompt += `   Use \`"status": "failed"\` if you cannot resolve the conflicts.\n`;
    prompt += `   The \`status\` field MUST be exactly \`"success"\` or \`"failed"\`.\n\n`;
    prompt += `## Important\n\n`;
    prompt += `- Do NOT run \`git rebase --abort\`. The orchestrator will handle cleanup if you fail.\n`;
    prompt += `- Do NOT run \`git push\`. The orchestrator will push after you exit.\n`;
    prompt += `- Focus only on resolving conflicts — do not make other code changes.\n`;

    return prompt;
  }

  private generateReviewPrompt(config: ActiveTaskConfig, context: TaskContext): string {
    let prompt = `# Review Task: ${context.title}\n\n`;
    prompt += `## Objective\n\n`;
    prompt += `Review the implementation of this task against its specification and acceptance criteria.\n\n`;
    prompt += `## Task Specification\n\n${context.description}\n\n`;

    const acceptanceCriteria = this.extractPlanSection(context.planContent, "Acceptance Criteria");
    if (acceptanceCriteria) {
      prompt += `## Acceptance Criteria\n\n${acceptanceCriteria}\n\n`;
    }

    prompt += `## Implementation\n\n`;
    prompt += `The coding agent has produced changes on branch \`${config.branch}\`. The orchestrator has already committed them before invoking you.\n`;
    prompt += `Run \`git diff main...${config.branch}\` to review the committed changes.\n\n`;
    prompt += `## Instructions\n\n`;
    prompt += `1. Review the diff between main and the task branch using \`git diff main...${config.branch}\`.\n`;
    prompt += `2. Verify the implementation meets ALL acceptance criteria.\n`;
    prompt += `3. Verify tests exist and cover the ticket scope (not just happy paths).\n`;
    prompt += `4. Run \`${config.testCommand}\` and confirm all tests pass.\n`;
    prompt += `5. Check code quality: no obvious bugs, reasonable error handling, consistent style.\n`;
    prompt += `6. Write your result to \`.opensprint/active/${config.taskId}/result.json\` using this exact JSON format:\n`;
    prompt += `   If approving (do NOT merge — the orchestrator will merge after you exit):\n`;
    prompt += `   \`\`\`json\n`;
    prompt += `   { "status": "approved", "summary": "Brief description of what was reviewed", "notes": "" }\n`;
    prompt += `   \`\`\`\n`;
    prompt += `   If rejecting:\n`;
    prompt += `   \`\`\`json\n`;
    prompt += `   { "status": "rejected", "summary": "One-line reason for rejection", "issues": ["Specific issue 1", "Specific issue 2"], "notes": "Additional context" }\n`;
    prompt += `   \`\`\`\n`;
    prompt += `   The \`status\` field MUST be exactly \`"approved"\` or \`"rejected"\`. The \`summary\` field is required. \`issues\` and \`notes\` are optional.\n\n`;

    return prompt;
  }
}
