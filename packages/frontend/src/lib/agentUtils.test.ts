import { describe, it, expect } from "vitest";
import { getPhaseForAgentNavigation, getAgentIconSrc, isPlanningAgent } from "./agentUtils";

describe("agentUtils", () => {
  describe("getPhaseForAgentNavigation", () => {
    it("returns sketch for Dreamer agent", () => {
      expect(
        getPhaseForAgentNavigation({
          id: "d1",
          phase: "spec",
          role: "dreamer",
          label: "Dreamer",
          startedAt: "2026-01-01T00:00:00Z",
        })
      ).toBe("sketch");
    });

    it("returns plan for Planner agent", () => {
      expect(
        getPhaseForAgentNavigation({
          id: "p1",
          phase: "plan",
          role: "planner",
          label: "Planner",
          startedAt: "2026-01-01T00:00:00Z",
        })
      ).toBe("plan");
    });

    it("returns eval for Analyst agent", () => {
      expect(
        getPhaseForAgentNavigation({
          id: "a1",
          phase: "eval",
          role: "analyst",
          label: "Analyst",
          startedAt: "2026-01-01T00:00:00Z",
        })
      ).toBe("eval");
    });

    it("returns execute for Coder agent", () => {
      expect(
        getPhaseForAgentNavigation({
          id: "c1",
          phase: "coding",
          role: "coder",
          label: "Coder",
          startedAt: "2026-01-01T00:00:00Z",
        })
      ).toBe("execute");
    });

    it("returns execute for Reviewer agent", () => {
      expect(
        getPhaseForAgentNavigation({
          id: "r1",
          phase: "review",
          role: "reviewer",
          label: "Reviewer",
          startedAt: "2026-01-01T00:00:00Z",
        })
      ).toBe("execute");
    });

    it("returns execute for phase-derived agent when role is coding", () => {
      expect(
        getPhaseForAgentNavigation({
          id: "x1",
          phase: "coding",
          label: "Agent",
          startedAt: "2026-01-01T00:00:00Z",
        })
      ).toBe("execute");
    });

    it("returns execute for phase-derived agent when role is review", () => {
      expect(
        getPhaseForAgentNavigation({
          id: "x1",
          phase: "review",
          label: "Agent",
          startedAt: "2026-01-01T00:00:00Z",
        })
      ).toBe("execute");
    });

    it("returns plan for phase-derived agent when phase is plan", () => {
      expect(
        getPhaseForAgentNavigation({
          id: "x1",
          phase: "plan",
          label: "Agent",
          startedAt: "2026-01-01T00:00:00Z",
        })
      ).toBe("plan");
    });

    it("returns sketch for phase-derived agent when phase is spec", () => {
      expect(
        getPhaseForAgentNavigation({
          id: "x1",
          phase: "spec",
          label: "Agent",
          startedAt: "2026-01-01T00:00:00Z",
        })
      ).toBe("sketch");
    });

    it("returns execute as default for unknown agent", () => {
      expect(
        getPhaseForAgentNavigation({
          id: "x1",
          phase: "unknown",
          label: "Agent",
          startedAt: "2026-01-01T00:00:00Z",
        })
      ).toBe("execute");
    });
  });

  describe("getAgentIconSrc", () => {
    it("returns dreamer icon for Dreamer role", () => {
      const src = getAgentIconSrc({
        id: "d1",
        phase: "spec",
        role: "dreamer",
        label: "Dreamer",
        startedAt: "2026-01-01T00:00:00Z",
      });
      expect(src).toContain("agent-icons/dreamer.svg");
    });
  });

  describe("isPlanningAgent", () => {
    it("returns true for Dreamer", () => {
      expect(
        isPlanningAgent({
          id: "d1",
          phase: "spec",
          role: "dreamer",
          label: "Dreamer",
          startedAt: "2026-01-01T00:00:00Z",
        })
      ).toBe(true);
    });

    it("returns true for Planner", () => {
      expect(
        isPlanningAgent({
          id: "p1",
          phase: "plan",
          role: "planner",
          label: "Planner",
          startedAt: "2026-01-01T00:00:00Z",
        })
      ).toBe(true);
    });

    it("returns false for Coder", () => {
      expect(
        isPlanningAgent({
          id: "c1",
          phase: "coding",
          role: "coder",
          label: "Coder",
          startedAt: "2026-01-01T00:00:00Z",
        })
      ).toBe(false);
    });
  });
});
