import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentRole } from "@opensprint/shared";
import {
  mineReplayGradeExecuteSessionIds,
  buildBehaviorExperimentCandidateBundle,
  SelfImprovementExperimentService,
  type BehaviorExperimentInstructionBaseline,
} from "../services/self-improvement-experiment.service.js";

vi.mock("../services/task-store.service.js", () => ({
  taskStore: {
    getDb: vi.fn(),
  },
}));

vi.mock("../services/behavior-version-store.service.js", () => ({
  runBehaviorVersionStoreWrite: vi.fn(),
}));

describe("self-improvement-experiment.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mineReplayGradeExecuteSessionIds returns numeric session ids", async () => {
    const { taskStore } = await import("../services/task-store.service.js");
    vi.mocked(taskStore.getDb).mockResolvedValue({
      query: vi.fn().mockResolvedValue([{ id: 42 }, { id: 43 }]),
    } as never);

    const ids = await mineReplayGradeExecuteSessionIds("proj-1");
    expect(ids).toEqual([42, 43]);
    expect(vi.mocked(taskStore.getDb)).toHaveBeenCalled();
  });

  it("buildBehaviorExperimentCandidateBundle includes mined ids and template diffs", () => {
    const baseline: BehaviorExperimentInstructionBaseline = {
      general: "base",
      roles: { coder: "role-c", reviewer: "role-r" } as Partial<Record<AgentRole, string>>,
      templates: { coder: "t-c", reviewer: "t-r", finalReview: "t-f", selfImprovement: "t-s" },
    };
    const bundle = buildBehaviorExperimentCandidateBundle({
      sessionIds: [7, 8],
      baseline,
      runId: "si-run",
    });
    expect(bundle.versionType).toBe("candidate");
    expect(bundle.minedSessionIds).toEqual([7, 8]);
    expect(bundle.runId).toBe("si-run");
    expect(bundle.generalInstructionDiff).toContain("diff --git");
    expect(bundle.promptTemplateDiffs.coder).toContain("scoped verification");
    expect(bundle.promptTemplateDiffs.selfImprovement).toContain("high-impact");
  });

  it("generateAndPersistCandidate persists bundle via BehaviorVersionStore.saveCandidate", async () => {
    const { taskStore } = await import("../services/task-store.service.js");
    vi.mocked(taskStore.getDb).mockResolvedValue({
      query: vi.fn().mockResolvedValue([{ id: 1 }]),
    } as never);

    const saveCandidate = vi.fn().mockResolvedValue(undefined);
    const { runBehaviorVersionStoreWrite } = await import("../services/behavior-version-store.service.js");
    vi.mocked(runBehaviorVersionStoreWrite).mockImplementation(async (fn) => {
      await fn({ saveCandidate } as never);
    });

    const instructions = {
      getGeneralInstructions: vi.fn().mockResolvedValue("general-body"),
      getRoleInstructions: vi.fn().mockResolvedValue("role-body"),
    };
    const svc = new SelfImprovementExperimentService(
      instructions as import("../services/agent-instructions.service.js").AgentInstructionsService
    );

    const { versionId, bundle } = await svc.generateAndPersistCandidate("proj-1", "run-z");
    expect(versionId).toBe("exp-run-z");
    expect(bundle.minedSessionIds).toEqual([1]);
    expect(saveCandidate).toHaveBeenCalledWith(
      "proj-1",
      "exp-run-z",
      expect.stringContaining('"versionType":"candidate"')
    );
  });
});
