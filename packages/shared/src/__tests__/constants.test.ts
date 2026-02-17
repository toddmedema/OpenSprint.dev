import { describe, it, expect } from "vitest";
import {
  KANBAN_COLUMNS,
  getTestCommandForFramework,
  resolveTestCommand,
} from "../constants/index.js";

describe("KANBAN_COLUMNS", () => {
  it("includes blocked status", () => {
    expect(KANBAN_COLUMNS).toContain("blocked");
  });

  it("includes all expected columns in display order", () => {
    expect(KANBAN_COLUMNS).toEqual([
      "planning",
      "backlog",
      "ready",
      "in_progress",
      "in_review",
      "done",
      "blocked",
    ]);
  });
});

describe("getTestCommandForFramework", () => {
  it("returns empty string for null", () => {
    expect(getTestCommandForFramework(null)).toBe("");
  });

  it("returns empty string for none", () => {
    expect(getTestCommandForFramework("none")).toBe("");
  });

  it("returns command for known framework", () => {
    expect(getTestCommandForFramework("jest")).toBe("npm test");
    expect(getTestCommandForFramework("vitest")).toBe("npx vitest run");
  });
});

describe("resolveTestCommand", () => {
  it("returns testCommand when set", () => {
    expect(
      resolveTestCommand({ testCommand: "pytest", testFramework: null })
    ).toBe("pytest");
  });

  it("returns framework command when testCommand not set", () => {
    expect(
      resolveTestCommand({ testCommand: null, testFramework: "vitest" })
    ).toBe("npx vitest run");
  });

  it("returns npm test when neither set", () => {
    expect(
      resolveTestCommand({ testCommand: null, testFramework: null })
    ).toBe("npm test");
  });

  it("returns npm test when framework is none", () => {
    expect(
      resolveTestCommand({ testCommand: null, testFramework: "none" })
    ).toBe("npm test");
  });
});
