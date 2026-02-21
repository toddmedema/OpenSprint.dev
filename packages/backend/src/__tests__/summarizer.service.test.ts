import { describe, it, expect } from "vitest";
import {
  shouldInvokeSummarizer,
  buildSummarizerPrompt,
  countWords,
} from "../services/summarizer.service.js";
import type { TaskContext } from "../services/context-assembler.js";

describe("summarizer.service", () => {
  const baseContext: TaskContext = {
    taskId: "task-1",
    title: "Task",
    description: "Desc",
    planContent: "Short plan",
    prdExcerpt: "PRD",
    dependencyOutputs: [],
  };

  describe("countWords", () => {
    it("counts words", () => {
      expect(countWords("one two three")).toBe(3);
      expect(countWords("  word  ")).toBe(1);
    });
  });

  describe("shouldInvokeSummarizer", () => {
    it("returns false when under both thresholds", () => {
      expect(shouldInvokeSummarizer(baseContext)).toBe(false);
    });

    it("returns true when >5 dependencies", () => {
      const ctx: TaskContext = {
        ...baseContext,
        dependencyOutputs: Array(6)
          .fill(null)
          .map((_, i) => ({ taskId: `dep-${i}`, diff: "", summary: "" })),
      };
      expect(shouldInvokeSummarizer(ctx)).toBe(true);
    });

    it("returns false when exactly 5 dependencies", () => {
      const ctx: TaskContext = {
        ...baseContext,
        dependencyOutputs: Array(5)
          .fill(null)
          .map((_, i) => ({ taskId: `dep-${i}`, diff: "", summary: "" })),
      };
      expect(shouldInvokeSummarizer(ctx)).toBe(false);
    });

    it("returns true when >5000 word plan", () => {
      const longPlan = Array(5001).fill("word").join(" ");
      const ctx: TaskContext = { ...baseContext, planContent: longPlan };
      expect(shouldInvokeSummarizer(ctx)).toBe(true);
    });

    it("returns false when exactly 5000 words", () => {
      const plan = Array(5000).fill("word").join(" ");
      const ctx: TaskContext = { ...baseContext, planContent: plan };
      expect(shouldInvokeSummarizer(ctx)).toBe(false);
    });
  });

  describe("buildSummarizerPrompt", () => {
    it("includes task id and context", () => {
      const prompt = buildSummarizerPrompt("task-1", baseContext, 3, 2500);
      expect(prompt).toContain("task-1");
      expect(prompt).toContain("3");
      expect(prompt).toContain("2500");
    });
  });
});
