import fs from "fs/promises";
import { shellExec } from "../../utils/shell-exec.js";
import { getCombinedInstructions } from "../agent-instructions.service.js";
import { parseMergerAgentResult } from "../agent-result-validation.js";
import { getMergeResultPath } from "../session-manager.js";
import type { RunMergerAgentOptions } from "./agent-types.js";

export const MERGER_MAIN_LOG_LIMIT = 5;

export const MERGER_RESULT_EXPECTED_SHAPE =
  'a JSON object like {"status":"success","summary":"..."} or {"status":"failed","summary":"..."}';

export async function captureMergerGitOutput(cwd: string, command: string): Promise<string> {
  try {
    const { stdout } = await shellExec(command, { cwd, timeout: 10_000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function verifyMergerGitResolution(cwd: string): Promise<boolean> {
  const unmerged = await captureMergerGitOutput(cwd, "git diff --name-only --diff-filter=U");
  if (unmerged.trim().length > 0) {
    return false;
  }
  try {
    await shellExec("git diff --check", { cwd, timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export async function readMergerAgentResultWithRaw(cwd: string): Promise<{
  raw: string | null;
  parsed: ReturnType<typeof parseMergerAgentResult>;
}> {
  const resultPath = getMergeResultPath(cwd);
  try {
    const raw = await fs.readFile(resultPath, "utf-8");
    return {
      raw,
      parsed: parseMergerAgentResult(raw),
    };
  } catch {
    return {
      raw: null,
      parsed: null,
    };
  }
}

export async function clearMergerResultFile(cwd: string): Promise<void> {
  try {
    await fs.unlink(getMergeResultPath(cwd));
  } catch {
    // File may not exist
  }
}

export async function buildMergerAgentPrompt(
  options: RunMergerAgentOptions,
  repairContext?: string
): Promise<string> {
  const baseBranch = options.baseBranch ?? "main";
  const [agentInstructions, statusShort, diffFilterU, mainLog, branchDiffStat] = await Promise.all([
    getCombinedInstructions(options.cwd, "merger"),
    captureMergerGitOutput(options.cwd, "git status --short"),
    captureMergerGitOutput(options.cwd, "git diff --name-only --diff-filter=U"),
    captureMergerGitOutput(
      options.cwd,
      `git log --oneline -${MERGER_MAIN_LOG_LIMIT} ${baseBranch}`
    ),
    captureMergerGitOutput(options.cwd, `git diff --stat ${baseBranch}...${options.branchName}`),
  ]);

  const conflictedFiles =
    options.conflictedFiles.length > 0 ? options.conflictedFiles.join("\n") : "(none reported)";
  const testCommand = options.testCommand?.trim() ? options.testCommand.trim() : "(not provided)";
  const mergeQualityGates =
    options.mergeQualityGates && options.mergeQualityGates.length > 0
      ? options.mergeQualityGates.map((cmd) => `- ${cmd}`).join("\n")
      : "- (not provided)";
  const resultPath = ".opensprint/merge-result.json";
  const repairSection = repairContext?.trim()
    ? `## Structured Output Repair\n\n` +
      `Your previous attempt did not produce a valid \`${resultPath}\` file.\n\n` +
      `${repairContext.trim()}\n\n` +
      `Reuse the current conflict-resolution state. Do not start over unless the git state itself is still wrong. Fix the structured output file before you exit.\n\n`
    : "";

  const basePrompt = `# Merger Agent: Resolve Git Conflicts

You are the Merger agent. Your job is to resolve ${options.phase} conflicts for task ${options.taskId} on branch ${options.branchName}.

## Conflict Context

- Stage: ${options.phase}
- Task ID: ${options.taskId}
- Branch: ${options.branchName}
- Base branch: ${baseBranch}
- Test command: ${testCommand}

### Required quality gates before merge
${mergeQualityGates}

### Conflicted files
${conflictedFiles}

### git status --short
${statusShort || "(no output)"}

### git diff --name-only --diff-filter=U
${diffFilterU || "(no output)"}

### Recent ${baseBranch} commits
${mainLog || "(no output)"}

### Branch diff stat vs ${baseBranch}
${branchDiffStat || "(no output)"}

${repairSection}## Your Task

1. Resolve every unmerged file and stage the resolved files.
2. Prefer preserving both sides when they are compatible.
3. Keep the branch compatible with the required quality gates above.
4. Verify there are no remaining conflict markers or unmerged paths.
5. Write your result to \`${resultPath}\` using this exact JSON format:
   \`\`\`json
   { "status": "success", "summary": "Brief description of how you resolved the conflicts" }
   \`\`\`
   If you cannot resolve the conflicts, write:
   \`\`\`json
   { "status": "failed", "summary": "Why the conflicts could not be resolved" }
   \`\`\`
   The \`status\` field MUST be exactly \`"success"\` or \`"failed"\`.
   You may optionally include a \`"debugArtifact"\` field to report diagnosis of any issues you encountered:
   \`\`\`json
   {
     "status": "success",
     "summary": "...",
     "debugArtifact": {
       "rootCauseCategory": "code_defect | env_defect | dependency_defect | ...",
       "evidence": "What you found",
       "fixApplied": "What you changed",
       "verificationCommand": "Command you ran to verify",
       "verificationPassed": true,
       "residualRisk": null,
       "nextAction": "continue"
     }
   }
   \`\`\`

## Rules

- Do NOT run \`git rebase --continue\`, \`git commit\`, or \`git merge --continue\`.
- Resolve conflicts by editing files; do not delete files unless that is clearly correct.
- Do NOT run destructive cleanup commands such as \`rm -rf\`, \`find ... -delete\`, or \`git clean -fdx\`.
- Run \`git diff --check\` before exiting.
- If post-resolution quality gates fail, diagnose the root cause from their output. Fix dependency drift, missing installs, or config issues directly. Re-run the failing gate to verify before reporting.
- Exit with code 0 only when all conflicted files are resolved and staged.
- Exit non-zero if you cannot produce a correct resolution.
`;
  if (agentInstructions.trim()) {
    return `${agentInstructions}\n\n${basePrompt}`;
  }
  return basePrompt;
}
