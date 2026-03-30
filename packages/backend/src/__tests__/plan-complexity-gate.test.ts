import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_SUB_PLAN_DEPTH } from "../services/plan/plan-prompts.js";

const { mockInvokeStructuredPlanningAgent } = vi.hoisted(() => ({
  mockInvokeStructuredPlanningAgent: vi.fn(),
}));

vi.mock("../services/structured-agent-output.service.js", () => ({
  invokeStructuredPlanningAgent: (...args: unknown[]) => mockInvokeStructuredPlanningAgent(...args),
}));

vi.mock("../services/agent-instructions.service.js", () => ({
  getCombinedInstructions: vi.fn().mockResolvedValue("## Open Sprint Defaults\n\n### Planner Defaults\n"),
}));

vi.mock("../services/plan/plan-repo-guard.js", () => ({
  runPlannerWithRepoGuard: vi.fn(async (opts: { run: () => Promise<unknown> }) => opts.run()),
}));

import { evaluatePlanComplexity } from "../services/plan/plan-complexity-gate.js";

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "proj-1",
    repoPath: "/tmp/test-repo",
    planContent: "# Feature\n\n## Overview\n\nBuild it.",
    prdContext: "PRD context here.",
    currentDepth: 1,
    agentConfig: { type: "cursor" as const, model: null, cliCommand: null },
    ...overrides,
  };
}

describe("evaluatePlanComplexity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forces tasks strategy at depth >= MAX_SUB_PLAN_DEPTH without calling the LLM", async () => {
    const result = await evaluatePlanComplexity(baseOptions({ currentDepth: MAX_SUB_PLAN_DEPTH }));

    expect(result).toEqual({ strategy: "tasks", tasks: [] });
    expect(mockInvokeStructuredPlanningAgent).not.toHaveBeenCalled();
  });

  it("forces tasks strategy at depth > MAX_SUB_PLAN_DEPTH without calling the LLM", async () => {
    const result = await evaluatePlanComplexity(baseOptions({ currentDepth: MAX_SUB_PLAN_DEPTH + 2 }));

    expect(result).toEqual({ strategy: "tasks", tasks: [] });
    expect(mockInvokeStructuredPlanningAgent).not.toHaveBeenCalled();
  });

  it("calls the LLM when depth < MAX_SUB_PLAN_DEPTH and returns tasks strategy", async () => {
    const agentResult = {
      strategy: "tasks" as const,
      tasks: [
        { title: "Task A", description: "Do A", priority: 1, dependsOn: [], complexity: 3 },
      ],
    };
    mockInvokeStructuredPlanningAgent.mockResolvedValue({
      ok: true,
      parsed: agentResult,
      initialRawContent: "{}",
      rawContent: "{}",
      repaired: false,
      attempts: 1,
      exhausted: false,
      fallbackApplied: false,
    });

    const result = await evaluatePlanComplexity(baseOptions({ currentDepth: 1 }));

    expect(mockInvokeStructuredPlanningAgent).toHaveBeenCalledTimes(1);
    expect(result).toEqual(agentResult);
  });

  it("calls the LLM when depth < MAX_SUB_PLAN_DEPTH and returns sub_plans strategy", async () => {
    const agentResult = {
      strategy: "sub_plans" as const,
      subPlans: [
        {
          title: "Auth",
          overview: "Auth subsystem",
          content: "# Auth\n\n## Overview\nAuth.",
          dependsOnPlans: [],
        },
        {
          title: "API",
          overview: "API layer",
          content: "# API\n\n## Overview\nAPI.",
          dependsOnPlans: ["auth"],
        },
      ],
    };
    mockInvokeStructuredPlanningAgent.mockResolvedValue({
      ok: true,
      parsed: agentResult,
      initialRawContent: "{}",
      rawContent: "{}",
      repaired: false,
      attempts: 1,
      exhausted: false,
      fallbackApplied: false,
    });

    const result = await evaluatePlanComplexity(baseOptions({ currentDepth: 2 }));

    expect(mockInvokeStructuredPlanningAgent).toHaveBeenCalledTimes(1);
    expect(result).toEqual(agentResult);
  });

  it("includes ancestor and sibling context in the prompt when provided", async () => {
    mockInvokeStructuredPlanningAgent.mockResolvedValue({
      ok: true,
      parsed: { strategy: "tasks", tasks: [] },
      initialRawContent: "{}",
      rawContent: "{}",
      repaired: false,
      attempts: 1,
      exhausted: false,
      fallbackApplied: false,
    });

    await evaluatePlanComplexity(
      baseOptions({
        currentDepth: 1,
        ancestorChainSummary: "Root plan: Build the app",
        siblingPlanSummaries: "Sibling: Auth module",
      }),
    );

    const call = mockInvokeStructuredPlanningAgent.mock.calls[0]?.[0];
    const userMessage = call?.messages?.[0]?.content as string;
    expect(userMessage).toContain("Root plan: Build the app");
    expect(userMessage).toContain("Sibling: Auth module");
    expect(userMessage).toContain("## Ancestor Chain");
    expect(userMessage).toContain("## Sibling Plans");
  });

  it("includes current depth in the user prompt", async () => {
    mockInvokeStructuredPlanningAgent.mockResolvedValue({
      ok: true,
      parsed: { strategy: "tasks", tasks: [] },
      initialRawContent: "{}",
      rawContent: "{}",
      repaired: false,
      attempts: 1,
      exhausted: false,
      fallbackApplied: false,
    });

    await evaluatePlanComplexity(baseOptions({ currentDepth: 3 }));

    const call = mockInvokeStructuredPlanningAgent.mock.calls[0]?.[0];
    const userMessage = call?.messages?.[0]?.content as string;
    expect(userMessage).toContain("depth **3**");
  });

  it("uses SUB_PLAN_DECOMPOSITION_SYSTEM_PROMPT in the system prompt", async () => {
    mockInvokeStructuredPlanningAgent.mockResolvedValue({
      ok: true,
      parsed: { strategy: "tasks", tasks: [] },
      initialRawContent: "{}",
      rawContent: "{}",
      repaired: false,
      attempts: 1,
      exhausted: false,
      fallbackApplied: false,
    });

    await evaluatePlanComplexity(baseOptions({ currentDepth: 1 }));

    const call = mockInvokeStructuredPlanningAgent.mock.calls[0]?.[0];
    const systemPrompt = call?.systemPrompt as string;
    expect(systemPrompt).toContain("strategy");
    expect(systemPrompt).toContain("sub_plans");
  });

  it("defaults to tasks strategy when agent returns no valid result", async () => {
    mockInvokeStructuredPlanningAgent.mockResolvedValue({
      ok: false,
      parsed: null,
      initialRawContent: "garbage",
      rawContent: "garbage",
      repaired: true,
      attempts: 2,
      exhausted: true,
      fallbackApplied: false,
      invalidReason: "Could not parse",
    });

    const result = await evaluatePlanComplexity(baseOptions({ currentDepth: 1 }));

    expect(result).toEqual({ strategy: "tasks", tasks: [] });
  });
});
