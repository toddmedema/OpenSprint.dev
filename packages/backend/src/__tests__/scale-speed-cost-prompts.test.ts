import { describe, it, expect } from "vitest";
import { DREAM_SYSTEM_PROMPT, PLAN_REFINEMENT_SYSTEM_PROMPT } from "../services/chat.service.js";
import { DECOMPOSE_SYSTEM_PROMPT } from "../services/plan/plan-prompts.js";
import { GENERATE_PLAN_SYSTEM_PROMPT } from "../services/plan-decompose-generate.service.js";

describe("scale/speed/cost prompt content", () => {
  describe("DREAM_SYSTEM_PROMPT", () => {
    it("contains the scale/speed/cost discovery heading", () => {
      expect(DREAM_SYSTEM_PROMPT).toContain("Scale, speed, and cost discovery");
    });

    it("references scale expectations", () => {
      expect(DREAM_SYSTEM_PROMPT).toContain("Scale");
      expect(DREAM_SYSTEM_PROMPT).toMatch(/scale/i);
    });

    it("references speed expectations", () => {
      expect(DREAM_SYSTEM_PROMPT).toContain("Speed");
      expect(DREAM_SYSTEM_PROMPT).toMatch(/speed/i);
    });

    it("references cost expectations", () => {
      expect(DREAM_SYSTEM_PROMPT).toContain("Cost");
      expect(DREAM_SYSTEM_PROMPT).toMatch(/cost/i);
    });

    it("mentions assumptions_and_constraints fallback", () => {
      expect(DREAM_SYSTEM_PROMPT).toContain("assumptions_and_constraints");
    });
  });

  describe("PLAN_REFINEMENT_SYSTEM_PROMPT", () => {
    it("references scale, speed, or cost constraints in recommendations", () => {
      expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toContain("scale");
      expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toContain("speed");
      expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toContain("cost");
    });

    it("ties constraints to Technical Approach changes", () => {
      expect(PLAN_REFINEMENT_SYSTEM_PROMPT).toMatch(
        /Technical Approach.*scale.*speed.*cost|scale.*speed.*cost.*Technical Approach/is
      );
    });
  });

  describe("DECOMPOSE_SYSTEM_PROMPT", () => {
    it("contains the scale/speed/cost heading", () => {
      expect(DECOMPOSE_SYSTEM_PROMPT).toContain("Scale, speed, and cost");
    });

    it("references Technical Approach", () => {
      expect(DECOMPOSE_SYSTEM_PROMPT).toContain("Technical Approach");
    });

    it("references Assumptions section for absent constraints", () => {
      expect(DECOMPOSE_SYSTEM_PROMPT).toContain("Assumptions");
    });
  });

  describe("GENERATE_PLAN_SYSTEM_PROMPT", () => {
    it("contains the scale/speed/cost awareness heading", () => {
      expect(GENERATE_PLAN_SYSTEM_PROMPT).toContain("Scale, speed, and cost awareness");
    });

    it("references scale, speed, and cost individually", () => {
      expect(GENERATE_PLAN_SYSTEM_PROMPT).toContain("scale");
      expect(GENERATE_PLAN_SYSTEM_PROMPT).toContain("speed");
      expect(GENERATE_PLAN_SYSTEM_PROMPT).toContain("cost");
    });

    it("instructs Assumptions note when constraints are absent", () => {
      expect(GENERATE_PLAN_SYSTEM_PROMPT).toContain(
        "No scale, speed, or cost constraints were specified; sensible defaults are assumed"
      );
    });

    it("does not alter the JSON output shape", () => {
      expect(GENERATE_PLAN_SYSTEM_PROMPT).toContain('"title"');
      expect(GENERATE_PLAN_SYSTEM_PROMPT).toContain('"content"');
      expect(GENERATE_PLAN_SYSTEM_PROMPT).toContain('"complexity"');
      expect(GENERATE_PLAN_SYSTEM_PROMPT).toContain('"mockups"');
    });
  });
});
