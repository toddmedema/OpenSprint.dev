import { describe, it, expect } from "vitest";
import {
  DECOMPOSE_SYSTEM_PROMPT,
  TASK_GENERATION_SYSTEM_PROMPT,
} from "../services/plan/plan-prompts.js";

describe("TASK_GENERATION_SYSTEM_PROMPT", () => {
  it("states the 15-task cap explicitly", () => {
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain(
      "Generate between 8 and 15 implementation tasks. Never exceed 15.",
    );
  });

  it("instructs consolidation when more than 15 tasks seem needed", () => {
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain(
      "consolidate related concerns into fewer, broader tasks rather than exceeding the cap",
    );
  });

  it("requires single-scope tasks with one primary outcome", () => {
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain(
      "Each task must have exactly one primary outcome",
    );
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain(
      "one file concern, one API endpoint, one component",
    );
  });

  it("requires explicit acceptance criteria in descriptions", () => {
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain(
      "**Acceptance criteria:** A numbered list of concrete, verifiable conditions",
    );
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain(
      "Each task description must contain explicit acceptance criteria (numbered list)",
    );
  });

  it("requires stable dependency references using exact titles", () => {
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain(
      "Use exact task titles from your output for dependsOn entries",
    );
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain(
      "copy them character-for-character",
    );
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain(
      "Do not paraphrase or abbreviate",
    );
  });

  it("preserves the JSON output schema", () => {
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain('"tasks"');
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain('"title"');
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain('"description"');
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain('"priority"');
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain('"dependsOn"');
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain('"complexity"');
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain('"files"');
  });

  it("retains task-level complexity range 1-10", () => {
    expect(TASK_GENERATION_SYSTEM_PROMPT).toContain(
      "Task-level complexity: integer 1-10 only",
    );
  });
});

describe("DECOMPOSE_SYSTEM_PROMPT", () => {
  it("contains the scale/speed/cost instruction paragraph", () => {
    expect(DECOMPOSE_SYSTEM_PROMPT).toContain(
      "**Scale, speed, and cost:**",
    );
  });

  it("references all three constraint categories", () => {
    expect(DECOMPOSE_SYSTEM_PROMPT).toContain("scale (users, data volume, growth)");
    expect(DECOMPOSE_SYSTEM_PROMPT).toContain("speed (latency, throughput)");
    expect(DECOMPOSE_SYSTEM_PROMPT).toContain("cost (budget, infrastructure)");
  });

  it("instructs Technical Approach handling when constraints are present", () => {
    expect(DECOMPOSE_SYSTEM_PROMPT).toContain(
      "ensure each relevant plan's Technical Approach reflects them",
    );
  });

  it("instructs Assumptions note when constraints are absent for affected plans", () => {
    expect(DECOMPOSE_SYSTEM_PROMPT).toContain(
      "add a brief note in the Assumptions section of plans likely affected by scale/speed/cost",
    );
  });

  it("does not alter the JSON output shape", () => {
    expect(DECOMPOSE_SYSTEM_PROMPT).toContain('"plans"');
    expect(DECOMPOSE_SYSTEM_PROMPT).toContain('"title"');
    expect(DECOMPOSE_SYSTEM_PROMPT).toContain('"content"');
    expect(DECOMPOSE_SYSTEM_PROMPT).toContain('"complexity"');
    expect(DECOMPOSE_SYSTEM_PROMPT).toContain('"dependsOnPlans"');
    expect(DECOMPOSE_SYSTEM_PROMPT).toContain('"mockups"');
  });
});
