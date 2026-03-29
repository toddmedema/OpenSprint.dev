/**
 * Canonical quality-gate commands that must pass before merge-to-main.
 * Keep this list aligned with CI merge-gate workflow.
 */
const DEFAULT_MERGE_QUALITY_GATE_COMMANDS = ["npm run build", "npm run lint", "npm run test"];

export type MergeQualityGateProfile = "default" | "deterministic";

export interface MergeQualityGateExecutionPlanEntry {
  command: string;
  env?: NodeJS.ProcessEnv;
}

export function getMergeQualityGateCommands(): string[] {
  return [...DEFAULT_MERGE_QUALITY_GATE_COMMANDS];
}

export function getMergeQualityGateExecutionPlan(options?: {
  profile?: MergeQualityGateProfile;
  testRunId?: string;
  integrationWorkerCap?: number;
}): MergeQualityGateExecutionPlanEntry[] {
  const commands = getMergeQualityGateCommands();
  if ((options?.profile ?? "default") !== "deterministic") {
    return commands.map((command) => ({ command }));
  }

  const runId = options?.testRunId?.trim();
  const workerCap = Number.isFinite(options?.integrationWorkerCap)
    ? Math.max(1, Math.floor(options!.integrationWorkerCap!))
    : 2;

  return commands.map((command) => {
    if (command !== "npm run test") return { command };
    return {
      command,
      env: {
        OPENSPRINT_MERGE_GATE_TEST_MODE: "1",
        OPENSPRINT_VITEST_RUN_ID: runId && runId.length > 0 ? runId : undefined,
        OPENSPRINT_VITEST_INTEGRATION_MAX_WORKERS: String(workerCap),
      },
    };
  });
}
