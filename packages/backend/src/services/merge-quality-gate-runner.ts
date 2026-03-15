import { createLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { shellExec as shellExecDefault } from "../utils/shell-exec.js";
import { BranchManager } from "./branch-manager.js";
import { getMergeQualityGateCommands } from "./merge-quality-gates.js";

const log = createLogger("merge-quality-gate-runner");
const QUALITY_GATE_FAILURE_OUTPUT_LIMIT = 4000;
const QUALITY_GATE_FAILURE_REASON_LIMIT = 500;
const QUALITY_GATE_AUTO_REPAIR_TIMEOUT_MS = 20 * 60 * 1000;
const QUALITY_GATE_ENV_FINGERPRINTS: RegExp[] = [
  /\bmodule_not_found\b/i,
  /cannot find module/i,
  /cannot find package/i,
  /enoent[\s\S]*node_modules/i,
  /missing node_modules/i,
  /no such file or directory[\s\S]*node_modules/i,
  /native addon/i,
  /could not locate the bindings file/i,
  /was compiled against a different node\.js version/i,
];

export interface MergeQualityGateRunOptions {
  projectId: string;
  repoPath: string;
  worktreePath: string;
  taskId: string;
  branchName: string;
  baseBranch: string;
}

export interface MergeQualityGateFailure {
  command: string;
  reason: string;
  output: string;
  outputSnippet?: string;
  worktreePath?: string;
  firstErrorLine?: string;
  category?: "environment_setup" | "quality_gate";
  autoRepairAttempted?: boolean;
  autoRepairSucceeded?: boolean;
  autoRepairCommands?: string[];
  autoRepairOutput?: string;
}

interface MergeQualityGateRunnerDeps {
  shellExec?: typeof shellExecDefault;
  symlinkNodeModules?: (repoPath: string, wtPath: string) => Promise<void>;
  commands?: string[];
}

function getFirstNonEmptyLine(value: string | null | undefined): string | null {
  if (!value) return null;
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null
  );
}

const QUALITY_GATE_NOISE_PATTERNS: RegExp[] = [
  /^\s*> /,
  /^\s*npm (error|err!)/i,
  /^\s*lifecycle script .* failed/i,
  /^\s*exit code \d+/i,
  /^\s*stderr \|/i,
  /^\s*RUN\s+v?\d/i,
  /^\s*Test Files\s+\d+\s+passed/i,
  /^\s*Tests\s+\d+\s+passed/i,
  /^\s*Start at /i,
  /^\s*Duration /i,
  /^\s*[|\\/-]{2,}\s*$/,
  /^\s*[=-]{3,}\s*$/,
  /^\s*✓\s+/,
  /^\s*at\s+\S+/,
  /^\s*node:/i,
];

const QUALITY_GATE_ACTIONABLE_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /\berror TS\d+\b/i, score: 130 },
  { pattern: /\b(AssertionError|TypeError|ReferenceError|SyntaxError|RangeError):/i, score: 125 },
  { pattern: /\bCannot find (module|package)\b/i, score: 120 },
  {
    pattern: /\b(not exported by|does not provide an export named|failed to resolve import)\b/i,
    score: 115,
  },
  { pattern: /\b\d+:\d+\s+error\b/i, score: 110 },
  { pattern: /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)\b.*[:(]\d+([:,)]\d+)?/i, score: 105 },
  { pattern: /^\s*FAIL\b/i, score: 100 },
  { pattern: /\b(Expected|Received):\b/, score: 95 },
  { pattern: /\berror during build\b/i, score: 90 },
  { pattern: /\b(Command failed|failed)\b/i, score: 75 },
  { pattern: /\bError:/i, score: 70 },
];

function isNoiseLine(line: string): boolean {
  return QUALITY_GATE_NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

function actionableScore(line: string): number {
  let score = 0;
  for (const rule of QUALITY_GATE_ACTIONABLE_PATTERNS) {
    if (rule.pattern.test(line)) {
      score = Math.max(score, rule.score);
    }
  }
  return score;
}

function getMeaningfulErrorIndex(lines: string[]): number {
  let bestIndex = -1;
  let bestScore = 0;

  lines.forEach((line, index) => {
    if (!line || isNoiseLine(line)) return;
    const score = actionableScore(line);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  if (bestIndex >= 0) return bestIndex;
  return lines.findIndex((line) => line.length > 0 && !isNoiseLine(line));
}

function getRelevantOutputSnippet(value: string | null | undefined): string {
  if (!value) return "";
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return "";

  const primaryIndex = getMeaningfulErrorIndex(lines);
  if (primaryIndex < 0) return "";

  const start = Math.max(0, primaryIndex - 1);
  const end = Math.min(lines.length, primaryIndex + 6);
  const snippetLines: string[] = [];

  for (let index = start; index < end; index += 1) {
    const line = lines[index]!;
    if (isNoiseLine(line)) continue;
    snippetLines.push(line);
    if (snippetLines.length >= 6) break;
  }

  if (snippetLines.length === 0) {
    snippetLines.push(lines[primaryIndex]!);
  }

  return snippetLines.join("\n").slice(0, QUALITY_GATE_FAILURE_OUTPUT_LIMIT);
}

function getFirstMeaningfulErrorLine(value: string | null | undefined): string | null {
  if (!value) return null;
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  const meaningfulIndex = getMeaningfulErrorIndex(lines);
  return meaningfulIndex >= 0 ? lines[meaningfulIndex]! : getFirstNonEmptyLine(value);
}

function extractShellFailure(
  command: string,
  err: unknown
): { reason: string; output: string; outputSnippet: string; firstErrorLine: string } {
  const e = err as { stdout?: string; stderr?: string; message?: string };
  const rawOutput = [e.stdout ?? "", e.stderr ?? ""]
    .filter((part) => part.trim().length > 0)
    .join("\n")
    .trim();
  const output = rawOutput.slice(0, QUALITY_GATE_FAILURE_OUTPUT_LIMIT);
  const outputSnippet = getRelevantOutputSnippet(rawOutput) || output;
  const reason = (e.message ?? `Command failed: ${command}`).slice(
    0,
    QUALITY_GATE_FAILURE_REASON_LIMIT
  );
  const firstErrorLine =
    getFirstMeaningfulErrorLine(rawOutput) ??
    getFirstNonEmptyLine(outputSnippet) ??
    getFirstNonEmptyLine(rawOutput) ??
    getFirstNonEmptyLine(reason) ??
    "Unknown quality gate failure";
  return { reason, output, outputSnippet, firstErrorLine };
}

function isQualityGateEnvironmentFailure(failure: {
  reason: string;
  output: string;
  firstErrorLine: string;
}): boolean {
  const text = `${failure.reason}\n${failure.output}\n${failure.firstErrorLine}`;
  return QUALITY_GATE_ENV_FINGERPRINTS.some((fingerprint) => fingerprint.test(text));
}

async function repairQualityGateEnvironment(
  repoPath: string,
  wtPath: string,
  deps: Required<Pick<MergeQualityGateRunnerDeps, "shellExec" | "symlinkNodeModules">>
): Promise<{ succeeded: boolean; commands: string[]; output: string }> {
  const outputParts: string[] = [];
  const repairRoot = wtPath === repoPath ? wtPath : repoPath;
  let npmCiSucceeded = false;
  try {
    const { stdout, stderr } = await deps.shellExec("npm ci", {
      cwd: repairRoot,
      timeout: QUALITY_GATE_AUTO_REPAIR_TIMEOUT_MS,
    });
    npmCiSucceeded = true;
    const npmCiOutput = [stdout, stderr].filter(Boolean).join("\n").trim();
    if (npmCiOutput) outputParts.push(`[npm ci] ${npmCiOutput}`);
  } catch (err) {
    const npmCiFailure = extractShellFailure("npm ci", err);
    const npmCiOutput = [npmCiFailure.reason, npmCiFailure.output]
      .filter(Boolean)
      .join("\n")
      .trim();
    if (npmCiOutput) outputParts.push(`[npm ci] ${npmCiOutput}`);
  }

  let symlinkSucceeded = true;
  try {
    await deps.symlinkNodeModules(repoPath, wtPath);
  } catch (err) {
    symlinkSucceeded = false;
    outputParts.push(`[symlinkNodeModules] ${getErrorMessage(err)}`);
  }

  return {
    succeeded: npmCiSucceeded && symlinkSucceeded,
    commands: ["npm ci", "symlinkNodeModules"],
    output: outputParts.join("\n").slice(0, QUALITY_GATE_FAILURE_OUTPUT_LIMIT),
  };
}

export async function runMergeQualityGates(
  options: MergeQualityGateRunOptions,
  deps: MergeQualityGateRunnerDeps = {}
): Promise<MergeQualityGateFailure | null> {
  // Test suites mock merge coordination heavily; skip expensive quality-gate execution in test runtime.
  if (process.env.NODE_ENV === "test") return null;

  const execute = deps.shellExec ?? shellExecDefault;
  const commands = deps.commands ?? getMergeQualityGateCommands();
  const symlinkNodeModules =
    deps.symlinkNodeModules ??
    (async (repoPath: string, wtPath: string) => {
      const branchManager = new BranchManager();
      await branchManager.symlinkNodeModules(repoPath, wtPath);
    });
  const cwd = options.worktreePath;

  for (const command of commands) {
    try {
      log.info("Running merge quality gate", {
        projectId: options.projectId,
        taskId: options.taskId,
        command,
        cwd,
      });
      await execute(command, {
        cwd,
        timeout: QUALITY_GATE_AUTO_REPAIR_TIMEOUT_MS,
      });
    } catch (err) {
      const initialFailure = extractShellFailure(command, err);
      const isEnvironmentFailure = isQualityGateEnvironmentFailure(initialFailure);
      if (!isEnvironmentFailure) {
        log.warn("Merge quality gate failed", {
          projectId: options.projectId,
          taskId: options.taskId,
          command,
          reason: initialFailure.reason,
        });
        return {
          command,
          reason: initialFailure.reason,
          output: initialFailure.output,
          outputSnippet: initialFailure.outputSnippet.slice(0, 1800),
          worktreePath: options.worktreePath,
          firstErrorLine: initialFailure.firstErrorLine,
          category: "quality_gate",
          autoRepairAttempted: false,
          autoRepairSucceeded: false,
          autoRepairCommands: [],
          autoRepairOutput: "",
        };
      }

      const autoRepair = await repairQualityGateEnvironment(
        options.repoPath,
        options.worktreePath,
        {
          shellExec: execute,
          symlinkNodeModules,
        }
      );
      try {
        log.info("Retrying merge quality gate after environment auto-repair", {
          projectId: options.projectId,
          taskId: options.taskId,
          command,
          repairCommands: autoRepair.commands,
        });
        await execute(command, {
          cwd,
          timeout: QUALITY_GATE_AUTO_REPAIR_TIMEOUT_MS,
        });
        continue;
      } catch (retryErr) {
        const retryFailure = extractShellFailure(command, retryErr);
        const retryStillEnvironmentFailure = isQualityGateEnvironmentFailure(retryFailure);
        const category = retryStillEnvironmentFailure ? "environment_setup" : "quality_gate";
        log.warn("Merge quality gate failed after environment auto-repair retry", {
          projectId: options.projectId,
          taskId: options.taskId,
          command,
          reason: retryFailure.reason,
          category,
        });
        return {
          command,
          reason: retryFailure.reason,
          output: retryFailure.output,
          outputSnippet: retryFailure.outputSnippet.slice(0, 1800),
          worktreePath: options.worktreePath,
          firstErrorLine: retryFailure.firstErrorLine,
          category,
          autoRepairAttempted: true,
          autoRepairSucceeded: autoRepair.succeeded,
          autoRepairCommands: autoRepair.commands,
          autoRepairOutput: autoRepair.output,
        };
      }
    }
  }

  return null;
}
