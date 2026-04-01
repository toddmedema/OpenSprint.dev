import { describe, it, expect } from "vitest";
import { getOpenSprintDefaultInstructions } from "../services/agent-default-instructions.js";

describe("getOpenSprintDefaultInstructions", () => {
  it("coder defaults include Protected Path Policy", () => {
    const instructions = getOpenSprintDefaultInstructions("coder");
    expect(instructions).toContain("Protected Path Policy");
    expect(instructions).toContain("integration/OAuth");
    expect(instructions).toContain("task prompt");
    expect(instructions).toContain("open_questions");
  });

  it("reviewer defaults include Protected Path Policy", () => {
    const instructions = getOpenSprintDefaultInstructions("reviewer");
    expect(instructions).toContain("Protected Path Policy");
    expect(instructions).toContain("integration/OAuth");
    expect(instructions).toContain("reject");
  });

  it("non-coder/reviewer roles do not mention Protected Path Policy", () => {
    const roles = ["dreamer", "planner", "harmonizer", "analyst", "summarizer", "auditor", "merger"] as const;
    for (const role of roles) {
      const instructions = getOpenSprintDefaultInstructions(role);
      expect(instructions).not.toContain("Protected Path Policy");
    }
  });

  it("shared defaults are present for all roles", () => {
    const instructions = getOpenSprintDefaultInstructions("coder");
    expect(instructions).toContain("Shared Defaults");
    expect(instructions).toContain("Follow the current phase");
  });
});
