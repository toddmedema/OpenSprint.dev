import { describe, it, expect } from "vitest";
import type { ActiveAgent } from "@opensprint/shared";
import {
  getPlanGenerationState,
  getActivePlannerPlanIds,
  getStalePlannerPlanIds,
  PLAN_STALE_THRESHOLD_MS,
} from "./planGenerationState";

function makeAgent(overrides: Partial<ActiveAgent> & { startedAt: string }): ActiveAgent {
  return {
    id: "agent-1",
    phase: "plan",
    role: "planner",
    label: "Planner",
    ...overrides,
  };
}

const NOW = new Date("2025-06-15T12:00:00Z").getTime();

describe("getPlanGenerationState", () => {
  it("returns 'ready' when no planner agent exists for the plan", () => {
    const agents: ActiveAgent[] = [];
    expect(getPlanGenerationState("plan-1", agents, NOW)).toBe("ready");
  });

  it("returns 'ready' when agents exist but none are planners for the plan", () => {
    const agents: ActiveAgent[] = [
      makeAgent({
        id: "a1",
        role: "coder",
        planId: "plan-1",
        startedAt: new Date(NOW - 1000).toISOString(),
      }),
      makeAgent({
        id: "a2",
        role: "planner",
        planId: "plan-other",
        startedAt: new Date(NOW - 1000).toISOString(),
      }),
    ];
    expect(getPlanGenerationState("plan-1", agents, NOW)).toBe("ready");
  });

  it("returns 'planning' when a planner is active and started < 5 minutes ago", () => {
    const agents: ActiveAgent[] = [
      makeAgent({ planId: "plan-1", startedAt: new Date(NOW - 60_000).toISOString() }),
    ];
    expect(getPlanGenerationState("plan-1", agents, NOW)).toBe("planning");
  });

  it("returns 'planning' at exactly the threshold minus 1ms", () => {
    const agents: ActiveAgent[] = [
      makeAgent({
        planId: "plan-1",
        startedAt: new Date(NOW - PLAN_STALE_THRESHOLD_MS + 1).toISOString(),
      }),
    ];
    expect(getPlanGenerationState("plan-1", agents, NOW)).toBe("planning");
  });

  it("returns 'stale' when a planner has been running >= 5 minutes", () => {
    const agents: ActiveAgent[] = [
      makeAgent({
        planId: "plan-1",
        startedAt: new Date(NOW - PLAN_STALE_THRESHOLD_MS).toISOString(),
      }),
    ];
    expect(getPlanGenerationState("plan-1", agents, NOW)).toBe("stale");
  });

  it("returns 'stale' when a planner has been running well beyond 5 minutes", () => {
    const agents: ActiveAgent[] = [
      makeAgent({
        planId: "plan-1",
        startedAt: new Date(NOW - 10 * 60 * 1000).toISOString(),
      }),
    ];
    expect(getPlanGenerationState("plan-1", agents, NOW)).toBe("stale");
  });

  it("only considers planner role, not other roles with matching planId", () => {
    const agents: ActiveAgent[] = [
      makeAgent({
        role: "auditor",
        planId: "plan-1",
        startedAt: new Date(NOW - 1000).toISOString(),
      }),
    ];
    expect(getPlanGenerationState("plan-1", agents, NOW)).toBe("ready");
  });
});

describe("getActivePlannerPlanIds", () => {
  it("returns empty set when no planners are active", () => {
    expect(getActivePlannerPlanIds([])).toEqual(new Set());
  });

  it("returns set of plan IDs with active planners", () => {
    const agents: ActiveAgent[] = [
      makeAgent({ id: "a1", planId: "plan-1", startedAt: new Date().toISOString() }),
      makeAgent({ id: "a2", planId: "plan-2", startedAt: new Date().toISOString() }),
      makeAgent({ id: "a3", role: "coder", planId: "plan-3", startedAt: new Date().toISOString() }),
    ];
    const result = getActivePlannerPlanIds(agents);
    expect(result).toEqual(new Set(["plan-1", "plan-2"]));
  });

  it("excludes agents without planId", () => {
    const agents: ActiveAgent[] = [makeAgent({ id: "a1", startedAt: new Date().toISOString() })];
    expect(getActivePlannerPlanIds(agents)).toEqual(new Set());
  });
});

describe("getStalePlannerPlanIds", () => {
  it("returns empty set when no planners are stale", () => {
    const agents: ActiveAgent[] = [
      makeAgent({ planId: "plan-1", startedAt: new Date(NOW - 60_000).toISOString() }),
    ];
    expect(getStalePlannerPlanIds(agents, NOW)).toEqual(new Set());
  });

  it("returns plan IDs of planners running >= 5 minutes", () => {
    const agents: ActiveAgent[] = [
      makeAgent({
        id: "a1",
        planId: "plan-1",
        startedAt: new Date(NOW - PLAN_STALE_THRESHOLD_MS).toISOString(),
      }),
      makeAgent({ id: "a2", planId: "plan-2", startedAt: new Date(NOW - 60_000).toISOString() }),
    ];
    expect(getStalePlannerPlanIds(agents, NOW)).toEqual(new Set(["plan-1"]));
  });
});
