import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  reviewSynthesizerService,
  type AngleReviewInput,
} from "../services/review-synthesizer.service.js";

// Avoid loading drizzle-orm/pg-core (vitest resolution can fail in some workspaces)
vi.mock("drizzle-orm", () => ({ and: (...args: unknown[]) => args, eq: (a: unknown, b: unknown) => [a, b] }));
vi.mock("../db/drizzle-schema-pg.js", () => ({ plansTable: {} }));

vi.mock("../services/agent.service.js", () => ({
  agentService: {
    invokePlanningAgent: vi.fn(),
  },
}));

vi.mock("../services/project.service.js", () => ({
  ProjectService: vi.fn().mockImplementation(() => ({
    getSettings: vi.fn().mockResolvedValue({
      simpleComplexityAgent: { type: "claude", model: "claude-sonnet" },
      complexComplexityAgent: { type: "claude", model: "claude-sonnet" },
    }),
  })),
}));

vi.mock("../services/plan-complexity.js", () => ({
  getComplexityForAgent: vi.fn().mockResolvedValue(undefined),
}));

describe("ReviewSynthesizerService", () => {
  const projectId = "proj-1";
  const repoPath = "/tmp/repo";
  const task = {
    id: "os-abc.1",
    title: "Task 1",
    description: "Do something",
  } as { id: string; title: string; description: string };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns synthesized result when agent produces valid JSON", async () => {
    const { agentService } = await import("../services/agent.service.js");
    vi.mocked(agentService.invokePlanningAgent).mockResolvedValue({
      content: JSON.stringify({
        status: "approved",
        summary: "All angles passed: Security, Performance.",
        notes: "",
      }),
    });

    const angleInputs: AngleReviewInput[] = [
      { angle: "security", result: { status: "approved", summary: "OK", notes: "" } },
      { angle: "performance", result: { status: "approved", summary: "OK", notes: "" } },
    ];
    const taskStore = {} as never;
    const result = await reviewSynthesizerService.synthesize(
      projectId,
      repoPath,
      task,
      angleInputs,
      taskStore
    );

    expect(result.status).toBe("approved");
    expect(result.summary).toContain("All angles passed");
    expect(agentService.invokePlanningAgent).toHaveBeenCalledTimes(1);
  });

  it("returns programmatic merge when agent fails", async () => {
    const { agentService } = await import("../services/agent.service.js");
    vi.mocked(agentService.invokePlanningAgent).mockRejectedValue(new Error("API error"));

    const angleInputs: AngleReviewInput[] = [
      { angle: "security", result: { status: "rejected", summary: "Bad", issues: ["X"], notes: "" } },
      { angle: "performance", result: { status: "approved", summary: "OK", notes: "" } },
    ];
    const taskStore = {} as never;
    const result = await reviewSynthesizerService.synthesize(
      projectId,
      repoPath,
      task,
      angleInputs,
      taskStore
    );

    expect(result.status).toBe("rejected");
    expect(result.issues).toContain("X");
    expect(result.summary).toContain("Bad");
  });

  it("programmatic merge combines rejected issues", async () => {
    const { agentService } = await import("../services/agent.service.js");
    vi.mocked(agentService.invokePlanningAgent).mockRejectedValue(new Error("fail"));

    const angleInputs: AngleReviewInput[] = [
      { angle: "security", result: { status: "rejected", summary: "S1", issues: ["A"], notes: "" } },
      { angle: "performance", result: { status: "rejected", summary: "S2", issues: ["B"], notes: "" } },
    ];
    const taskStore = {} as never;
    const result = await reviewSynthesizerService.synthesize(
      projectId,
      repoPath,
      task,
      angleInputs,
      taskStore
    );

    expect(result.status).toBe("rejected");
    expect(result.issues).toEqual(expect.arrayContaining(["A", "B"]));
  });
});
