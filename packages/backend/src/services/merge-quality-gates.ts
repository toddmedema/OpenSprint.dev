import type { ToolchainProfile } from "@opensprint/shared";
import { resolveToolchainProfile } from "./toolchain-profile.service.js";

export type MergeQualityGateProfile = "default" | "deterministic";

export interface MergeQualityGateExecutionPlanEntry {
  command: string;
  env?: NodeJS.ProcessEnv;
}

export function getMergeQualityGateCommands(toolchainProfile?: ToolchainProfile | null): string[] {
  return resolveToolchainProfile(toolchainProfile).mergeQualityGateCommands;
}

export function getMergeQualityGateExecutionPlan(options?: {
  profile?: MergeQualityGateProfile;
  testRunId?: string;
  integrationWorkerCap?: number;
  toolchainProfile?: ToolchainProfile | null;
}): MergeQualityGateExecutionPlanEntry[] {
  const resolved = resolveToolchainProfile(options?.toolchainProfile);
  const commands = resolved.mergeQualityGateCommands;
  if ((options?.profile ?? "default") !== "deterministic") {
    return commands.map((command) => ({ command }));
  }

  const runId = options?.testRunId?.trim();
  const workerCap = Number.isFinite(options?.integrationWorkerCap)
    ? Math.max(1, Math.floor(options!.integrationWorkerCap!))
    : 2;
  const deterministicTestCommand = resolved.deterministicTestCommand;
  const deterministicTestEnv = resolved.deterministicTestEnv;

  return commands.map((command) => {
    if (!deterministicTestCommand || command !== deterministicTestCommand) return { command };
    const env: Record<string, string> = {
      /** Marker for subprocesses; keep test auth patterns aligned with `local-auth-test-helpers.ts`. */
      OPENSPRINT_MERGE_GATE_TEST_MODE: "1",
      OPENSPRINT_VITEST_INTEGRATION_MAX_WORKERS: String(workerCap),
      ...deterministicTestEnv,
      /** Always last so profile extras cannot override test mode for the gate subprocess. */
      NODE_ENV: "test",
    };
    if (runId && runId.length > 0) {
      env.OPENSPRINT_VITEST_RUN_ID = runId;
    }
    return { command, env };
  });
}
