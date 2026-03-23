/**
 * Per-project async semaphore for maxTotalConcurrentAgents (planning + coding + merger).
 */
import type { ProjectSettings } from "@opensprint/shared";
import {
  DEFAULT_AI_AUTONOMY_LEVEL,
  DEFAULT_DEPLOYMENT_CONFIG,
  DEFAULT_REVIEW_MODE,
  hilConfigFromAiAutonomyLevel,
  parseSettings,
} from "@opensprint/shared";
import { getSettingsFromStore } from "./settings-store.service.js";

const DEFAULT_AGENT = {
  type: "cursor" as const,
  model: null as string | null,
  cliCommand: null as string | null,
};

function storeReadDefaults(): ProjectSettings {
  return {
    simpleComplexityAgent: { ...DEFAULT_AGENT },
    complexComplexityAgent: { ...DEFAULT_AGENT },
    deployment: { ...DEFAULT_DEPLOYMENT_CONFIG },
    aiAutonomyLevel: DEFAULT_AI_AUTONOMY_LEVEL,
    hilConfig: hilConfigFromAiAutonomyLevel(DEFAULT_AI_AUTONOMY_LEVEL),
    testFramework: null,
    testCommand: null,
    validationTimeoutMsOverride: null,
    reviewMode: DEFAULT_REVIEW_MODE,
    maxConcurrentCoders: 1,
    unknownScopeStrategy: "optimistic",
    gitWorkingMode: "worktree",
    mergeStrategy: "per_task",
    worktreeBaseBranch: "main",
    enableHumanTeammates: false,
    selfImprovementFrequency: "never",
    autoExecutePlans: false,
    runAgentEnhancementExperiments: false,
  };
}

interface ProjectSemaphoreState {
  limit: number;
  inFlight: number;
  waitQueue: Array<() => void>;
}

const semaphores = new Map<string, ProjectSemaphoreState>();

function getState(projectId: string, limit: number): ProjectSemaphoreState {
  let s = semaphores.get(projectId);
  if (!s || s.limit !== limit) {
    s = { limit, inFlight: 0, waitQueue: [] };
    semaphores.set(projectId, s);
  }
  return s;
}

async function readLimit(projectId: string): Promise<number | undefined> {
  const stored = await getSettingsFromStore(projectId, storeReadDefaults());
  const parsed = parseSettings(stored as unknown as Record<string, unknown>);
  return parsed.maxTotalConcurrentAgents ?? undefined;
}

/**
 * Wait until a global agent slot is available for this project, then return a release function.
 * When maxTotalConcurrentAgents is unset, returns a no-op release immediately.
 */
export async function acquireGlobalAgentSlot(projectId: string): Promise<() => void> {
  const limit = await readLimit(projectId);
  if (limit == null || limit < 1) {
    return () => {};
  }

  const state = getState(projectId, limit);

  while (state.inFlight >= state.limit) {
    await new Promise<void>((resolve) => {
      state.waitQueue.push(resolve);
    });
  }

  state.inFlight += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.inFlight -= 1;
    const next = state.waitQueue.shift();
    if (next) next();
  };
}

/** Test hook: reset semaphore state for a project. */
export function resetGlobalAgentConcurrencyForTests(projectId?: string): void {
  if (projectId) semaphores.delete(projectId);
  else semaphores.clear();
}
