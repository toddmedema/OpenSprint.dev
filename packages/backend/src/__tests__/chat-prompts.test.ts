import { describe, it, expect } from "vitest";
import {
  DREAM_SYSTEM_PROMPT,
  PLAN_REFINEMENT_SYSTEM_PROMPT,
} from "../services/chat.service.js";

describe("DREAM_SYSTEM_PROMPT — scale/speed/cost discovery", () => {
  it("contains the discovery header paragraph", () => {
    expect(DREAM_SYSTEM_PROMPT).toContain(
      "**Scale, speed, and cost discovery:**",
    );
  });

  it("lists all three constraint categories with examples", () => {
    expect(DREAM_SYSTEM_PROMPT).toContain("**Scale** — expected users, data volume");
    expect(DREAM_SYSTEM_PROMPT).toContain("**Speed** — latency targets, throughput");
    expect(DREAM_SYSTEM_PROMPT).toContain("**Cost** — infrastructure budget, hosting constraints");
  });

  it("instructs the agent to ask the user when constraints are missing", () => {
    expect(DREAM_SYSTEM_PROMPT).toContain(
      "Do you have any requirements around scale (e.g., expected users or data volume), speed (latency/throughput targets), or cost (budget or infrastructure constraints)?",
    );
    expect(DREAM_SYSTEM_PROMPT).toContain(
      "I'll proceed with sensible defaults",
    );
  });

  it("instructs reflection in technical_architecture and non_functional_requirements", () => {
    expect(DREAM_SYSTEM_PROMPT).toContain(
      "reflect it in technical_architecture and non_functional_requirements",
    );
  });

  it("instructs noting in assumptions_and_constraints when user declines", () => {
    expect(DREAM_SYSTEM_PROMPT).toContain(
      "note in assumptions_and_constraints that no scale/speed/cost requirements were specified and defaults are assumed",
    );
  });

  it("places discovery before finalizing technical_architecture or non_functional_requirements", () => {
    expect(DREAM_SYSTEM_PROMPT).toContain(
      "Before finalizing the technical_architecture or non_functional_requirements sections",
    );
  });

  it("does not alter the PRD_UPDATE format or valid section keys", () => {
    expect(DREAM_SYSTEM_PROMPT).toContain("[PRD_UPDATE:");
    expect(DREAM_SYSTEM_PROMPT).toContain("[/PRD_UPDATE]");
    expect(DREAM_SYSTEM_PROMPT).toContain("Valid section keys:");
    expect(DREAM_SYSTEM_PROMPT).toContain("executive_summary");
    expect(DREAM_SYSTEM_PROMPT).toContain("technical_architecture");
    expect(DREAM_SYSTEM_PROMPT).toContain("non_functional_requirements");
  });
});

describe("PLAN_REFINEMENT_SYSTEM_PROMPT — scale/speed/cost item", () => {
  it("includes numbered item 6 about scale/speed/cost", () => {
    expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toMatch(
      /6\.\s+When suggesting changes to the Technical Approach/,
    );
  });

  it("references scale, speed, and cost constraints in item 6", () => {
    const match = PLAN_REFINEMENT_SYSTEM_PROMPT.match(
      /6\..*scale.*speed.*cost/is,
    );
    expect(match).not.toBeNull();
  });

  it("connects constraints to recommendations", () => {
    expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toContain(
      "reflect them in your recommendations",
    );
  });

  it("preserves existing numbered items 1-5", () => {
    expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toMatch(/1\.\s+Answer questions/);
    expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toMatch(/2\.\s+Suggest improvements/);
    expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toMatch(/3\.\s+Identify gaps/);
    expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toMatch(/4\.\s+Propose refinements/);
    expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toMatch(/5\.\s+When discussing visuals/);
  });

  it("item 6 appears after item 5 in the prompt text", () => {
    const item5Idx = PLAN_REFINEMENT_SYSTEM_PROMPT.indexOf("5. When discussing visuals");
    const item6Idx = PLAN_REFINEMENT_SYSTEM_PROMPT.indexOf("6. When suggesting changes");
    expect(item5Idx).toBeGreaterThan(-1);
    expect(item6Idx).toBeGreaterThan(item5Idx);
  });

  it("item 6 appears within the 'Your role is to:' numbered list", () => {
    const roleIdx = PLAN_REFINEMENT_SYSTEM_PROMPT.indexOf("Your role is to:");
    const item6Idx = PLAN_REFINEMENT_SYSTEM_PROMPT.indexOf("6. When suggesting changes");
    const planUpdateIdx = PLAN_REFINEMENT_SYSTEM_PROMPT.indexOf("[PLAN_UPDATE]");
    expect(roleIdx).toBeGreaterThan(-1);
    expect(item6Idx).toBeGreaterThan(roleIdx);
    expect(item6Idx).toBeLessThan(planUpdateIdx);
  });

  it("does not introduce a 7th numbered item", () => {
    expect(PLAN_REFINEMENT_SYSTEM_PROMPT).not.toMatch(/^7\./m);
  });

  it("does not alter PLAN_UPDATE format", () => {
    expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toContain("[PLAN_UPDATE]");
    expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toContain("[/PLAN_UPDATE]");
  });

  it("preserves required plan section structure", () => {
    expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toContain("Feature Title");
    expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toContain("Acceptance Criteria");
    expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toContain("Technical Approach");
    expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toContain("Estimated Complexity");
  });

  it("preserves Assumptions section instruction", () => {
    expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toContain("**Assumptions (## Assumptions):**");
  });
});
