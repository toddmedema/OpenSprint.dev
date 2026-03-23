import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProjectSettings } from "@opensprint/shared";
import {
  acquireGlobalAgentSlot,
  resetGlobalAgentConcurrencyForTests,
} from "../services/agent-global-concurrency.service.js";
import * as settingsStore from "../services/settings-store.service.js";

vi.mock("../services/settings-store.service.js", () => ({
  getSettingsFromStore: vi.fn(),
}));

const mockGetSettings = vi.mocked(settingsStore.getSettingsFromStore);

function minimalSettings(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
  return {
    simpleComplexityAgent: { type: "cursor", model: null, cliCommand: null },
    complexComplexityAgent: { type: "cursor", model: null, cliCommand: null },
    deployment: { mode: "custom" },
    aiAutonomyLevel: "full",
    hilConfig: {
      scopeChanges: "automated",
      architectureDecisions: "automated",
      dependencyModifications: "automated",
    },
    testFramework: null,
    maxConcurrentCoders: 1,
    unknownScopeStrategy: "optimistic",
    gitWorkingMode: "worktree",
    mergeStrategy: "per_task",
    worktreeBaseBranch: "main",
    enableHumanTeammates: false,
    selfImprovementFrequency: "never",
    autoExecutePlans: false,
    runAgentEnhancementExperiments: false,
    ...overrides,
  };
}

describe("agent-global-concurrency.service", () => {
  beforeEach(() => {
    resetGlobalAgentConcurrencyForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetGlobalAgentConcurrencyForTests();
  });

  it("returns no-op release when maxTotalConcurrentAgents is unset", async () => {
    mockGetSettings.mockResolvedValue(minimalSettings());
    const r = await acquireGlobalAgentSlot("proj-a");
    expect(typeof r).toBe("function");
    r();
  });

  it("allows at most N concurrent holders for the same project", async () => {
    mockGetSettings.mockResolvedValue(minimalSettings({ maxTotalConcurrentAgents: 2 }));

    let peak = 0;
    let current = 0;

    const hold = async () => {
      const release = await acquireGlobalAgentSlot("proj-b");
      current += 1;
      peak = Math.max(peak, current);
      await new Promise((r) => setTimeout(r, 20));
      current -= 1;
      release();
    };

    await Promise.all([hold(), hold(), hold()]);

    expect(peak).toBe(2);
  });

  it("does not throttle across different project ids", async () => {
    mockGetSettings.mockResolvedValue(minimalSettings({ maxTotalConcurrentAgents: 1 }));

    const track = async (pid: string, ref: { peak: number; cur: number }) => {
      const release = await acquireGlobalAgentSlot(pid);
      ref.cur += 1;
      ref.peak = Math.max(ref.peak, ref.cur);
      await new Promise((r) => setTimeout(r, 15));
      ref.cur -= 1;
      release();
    };

    const x = { peak: 0, cur: 0 };
    const y = { peak: 0, cur: 0 };
    await Promise.all([track("p-x", x), track("p-x", x), track("p-y", y), track("p-y", y)]);

    expect(x.peak).toBe(1);
    expect(y.peak).toBe(1);
  });
});
