import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeStructuredPlanningAgent } from "../services/structured-agent-output.service.js";
import { agentService } from "../services/agent.service.js";

vi.mock("../services/agent.service.js", () => ({
  agentService: {
    invokePlanningAgent: vi.fn(),
  },
}));

describe("invokeStructuredPlanningAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the first parsed response without retrying", async () => {
    vi.mocked(agentService.invokePlanningAgent).mockResolvedValue({
      content: '{"status":"ok"}',
    });

    const result = await invokeStructuredPlanningAgent({
      projectId: "proj-1",
      role: "planner",
      config: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
      messages: [{ role: "user", content: "Give me JSON" }],
      contract: {
        parse: (content) => {
          try {
            return JSON.parse(content) as { status: string };
          } catch {
            return null;
          }
        },
        repairPrompt: "Return valid JSON only.",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.repaired).toBe(false);
    expect(result.parsed).toEqual({ status: "ok" });
    expect(agentService.invokePlanningAgent).toHaveBeenCalledTimes(1);
  });

  it("retries once with the repair prompt when the first response is invalid", async () => {
    vi.mocked(agentService.invokePlanningAgent)
      .mockResolvedValueOnce({ content: "not json" })
      .mockResolvedValueOnce({ content: '{"status":"fixed"}' });

    const result = await invokeStructuredPlanningAgent({
      projectId: "proj-1",
      role: "planner",
      config: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
      messages: [{ role: "user", content: "Give me JSON" }],
      tracking: {
        id: "plan-run",
        projectId: "proj-1",
        phase: "plan",
        role: "planner",
        label: "Plan generation",
      },
      contract: {
        parse: (content) => {
          try {
            return JSON.parse(content) as { status: string };
          } catch {
            return null;
          }
        },
        repairPrompt: "Return valid JSON only.",
        invalidReason: () => "The previous response was not valid JSON.",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.parsed).toEqual({ status: "fixed" });
    expect(agentService.invokePlanningAgent).toHaveBeenCalledTimes(2);
    expect(vi.mocked(agentService.invokePlanningAgent).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        tracking: expect.objectContaining({
          id: "plan-run-repair",
          label: "Plan generation",
        }),
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "assistant", content: "not json" }),
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("Previous parse failure"),
          }),
        ]),
      })
    );
  });

  it("returns the exhausted fallback after a second invalid response", async () => {
    vi.mocked(agentService.invokePlanningAgent)
      .mockResolvedValueOnce({ content: "bad" })
      .mockResolvedValueOnce({ content: "still bad" });

    const result = await invokeStructuredPlanningAgent({
      projectId: "proj-1",
      role: "planner",
      config: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
      messages: [{ role: "user", content: "Give me JSON" }],
      contract: {
        parse: () => null,
        repairPrompt: "Return valid JSON only.",
        onExhausted: () => ({ status: "fallback" }),
      },
    });

    expect(result.ok).toBe(false);
    expect(result.repaired).toBe(true);
    expect(result.exhausted).toBe(true);
    expect(result.fallbackApplied).toBe(true);
    expect(result.parsed).toEqual({ status: "fallback" });
    expect(agentService.invokePlanningAgent).toHaveBeenCalledTimes(2);
  });

  it("propagates agent invocation errors without swallowing them", async () => {
    vi.mocked(agentService.invokePlanningAgent).mockRejectedValue(new Error("boom"));

    await expect(
      invokeStructuredPlanningAgent({
        projectId: "proj-1",
        role: "planner",
        config: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
        messages: [{ role: "user", content: "Give me JSON" }],
        contract: {
          parse: () => null,
          repairPrompt: "Return valid JSON only.",
        },
      })
    ).rejects.toThrow("boom");
  });
});
