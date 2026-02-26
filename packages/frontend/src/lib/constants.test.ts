import { describe, it, expect } from "vitest";
import {
  CONTENT_CONTAINER_CLASS,
  GITHUB_REPO_URL,
  HOMEPAGE_CONTAINER_CLASS,
  NAVBAR_HEIGHT,
  PRD_SECTION_ORDER,
  PRD_SOURCE_COLORS,
  PRD_SOURCE_LABELS,
  getPrdSourceColor,
} from "./constants";

describe("constants", () => {
  describe("NAVBAR_HEIGHT", () => {
    it("is 56px for consistent navbar height across home and project pages", () => {
      expect(NAVBAR_HEIGHT).toBe(56);
    });
  });

  describe("CONTENT_CONTAINER_CLASS", () => {
    it("includes max-w-3xl mx-auto px-6 for evaluate feedback alignment", () => {
      expect(CONTENT_CONTAINER_CLASS).toContain("max-w-3xl");
      expect(CONTENT_CONTAINER_CLASS).toContain("mx-auto");
      expect(CONTENT_CONTAINER_CLASS).toContain("px-6");
    });
  });

  describe("HOMEPAGE_CONTAINER_CLASS", () => {
    it("includes max-w-[86.5rem] mx-auto px-6 for wider homepage header and cards", () => {
      expect(HOMEPAGE_CONTAINER_CLASS).toContain("max-w-[86.5rem]");
      expect(HOMEPAGE_CONTAINER_CLASS).toContain("mx-auto");
      expect(HOMEPAGE_CONTAINER_CLASS).toContain("px-6");
    });
  });

  describe("GITHUB_REPO_URL", () => {
    it("points to OpenSprint GitHub repository", () => {
      expect(GITHUB_REPO_URL).toContain("github.com");
      expect(GITHUB_REPO_URL).toContain("opensprint");
    });
  });

  describe("PRD_SECTION_ORDER", () => {
    it("contains expected section keys in order", () => {
      expect(PRD_SECTION_ORDER[0]).toBe("executive_summary");
      expect(PRD_SECTION_ORDER).toContain("problem_statement");
      expect(PRD_SECTION_ORDER).toContain("open_questions");
      expect(PRD_SECTION_ORDER.length).toBe(10);
    });
  });

  describe("PRD_SOURCE_LABELS", () => {
    it("maps sketch to Sketch for user-facing display", () => {
      expect(PRD_SOURCE_LABELS.sketch).toBe("Sketch");
      expect(PRD_SOURCE_LABELS.plan).toBe("Plan");
      expect(PRD_SOURCE_LABELS.execute).toBe("Execute");
      expect(PRD_SOURCE_LABELS.eval).toBe("Evaluate");
      expect(PRD_SOURCE_LABELS.deliver).toBe("Deliver");
    });
  });

  describe("PRD_SOURCE_COLORS", () => {
    it("has theme-aware colors for sketch, plan, execute, eval, deliver", () => {
      expect(PRD_SOURCE_COLORS.sketch).toContain("bg-theme-info-bg");
      expect(PRD_SOURCE_COLORS.plan).toContain("bg-theme-warning-bg");
      expect(PRD_SOURCE_COLORS.execute).toContain("bg-theme-success-bg");
      expect(PRD_SOURCE_COLORS.eval).toContain("bg-theme-feedback-feature-bg");
      expect(PRD_SOURCE_COLORS.deliver).toContain("bg-theme-surface-muted");
    });
  });

  describe("getPrdSourceColor", () => {
    it("returns same colors as PRD_SOURCE_COLORS for known source keys", () => {
      const sources = ["sketch", "plan", "execute", "eval", "deliver"] as const;
      for (const source of sources) {
        expect(getPrdSourceColor(source)).toBe(PRD_SOURCE_COLORS[source]);
      }
    });

    it("returns default purple for unknown sources", () => {
      expect(getPrdSourceColor("unknown")).toContain("bg-theme-feedback-feature-bg");
      expect(getPrdSourceColor("")).toContain("bg-theme-feedback-feature-bg");
    });
  });
});
