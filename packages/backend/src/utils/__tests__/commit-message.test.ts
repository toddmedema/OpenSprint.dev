import { describe, it, expect } from "vitest";
import {
  truncateTitle,
  formatClosedCommitMessage,
  parseClosedCommitMessage,
  TITLE_MAX_LEN,
} from "../commit-message.js";

describe("commit-message utils", () => {
  describe("truncateTitle", () => {
    it("returns title unchanged when within limit", () => {
      expect(truncateTitle("Short title")).toBe("Short title");
    });

    it("returns title unchanged when exactly at limit", () => {
      const exact = "A".repeat(TITLE_MAX_LEN);
      expect(truncateTitle(exact)).toBe(exact);
    });

    it("truncates at word boundary with ellipsis", () => {
      const title = "Add agent heartbeat monitoring and reporting to dashboard";
      const result = truncateTitle(title);
      expect(result).toBe("Add agent heartbeat monitoring and reporting\u2026");
      expect(result.length).toBeLessThanOrEqual(46);
    });

    it("hard-cuts when no word boundary found before limit", () => {
      const title = "A".repeat(50);
      const result = truncateTitle(title);
      expect(result).toBe("A".repeat(45) + "\u2026");
      expect(result.length).toBe(46);
    });

    it("respects custom maxLen", () => {
      expect(truncateTitle("Hello world of testing", 10)).toBe("Hello\u2026");
    });

    it("handles empty string", () => {
      expect(truncateTitle("")).toBe("");
    });
  });

  describe("formatClosedCommitMessage", () => {
    it("matches squash commit spec: Closed [task ID]: [task name ~45 chars]", () => {
      const msg = formatClosedCommitMessage(
        "opensprint.dev-81r.6",
        "Use descriptive squash commit format when landing the plane"
      );
      expect(msg).toMatch(/^Closed opensprint\.dev-81r\.6: /);
      const titlePart = msg.replace(/^Closed [^:]+: /, "");
      expect(titlePart.length).toBeLessThanOrEqual(46); // ~45 chars + ellipsis
      expect(msg).toContain("Use descriptive squash");
    });

    it("includes task ID and title", () => {
      expect(formatClosedCommitMessage("opensprint.dev-abc.1", "Add login")).toBe(
        "Closed opensprint.dev-abc.1: Add login"
      );
    });

    it("truncates long titles to ~45 chars", () => {
      const longTitle = "Add agent heartbeat monitoring and reporting to dashboard and API";
      const msg = formatClosedCommitMessage("opensprint.dev-zar.3", longTitle);
      expect(msg).toMatch(/^Closed opensprint\.dev-zar\.3: .+\u2026$/);
      expect(msg).not.toContain("and API");
    });

    it("preserves short titles exactly", () => {
      expect(formatClosedCommitMessage("bd-x.1", "Fix typo")).toBe("Closed bd-x.1: Fix typo");
    });

    it("format matches spec: Closed [task ID]: [task name ~45 chars]", () => {
      const taskId = "opensprint.dev-81r.6";
      const longTitle = "Use descriptive squash commit format when landing the plane";
      const msg = formatClosedCommitMessage(taskId, longTitle);
      expect(msg).toMatch(/^Closed [^:]+: .+$/);
      const [, id, title] = msg.match(/^Closed ([^:]+): (.+)$/)!;
      expect(id).toBe(taskId);
      expect(title.length).toBeLessThanOrEqual(46);
      expect(msg.startsWith("Closed ")).toBe(true);
    });
  });

  describe("parseClosedCommitMessage", () => {
    it("parses valid Closed format", () => {
      const result = parseClosedCommitMessage("Closed opensprint.dev-abc.1: Add feature");
      expect(result).toEqual({ taskId: "opensprint.dev-abc.1", title: "Add feature" });
    });

    it("parses Closed format with long title", () => {
      const result = parseClosedCommitMessage(
        "Closed opensprint.dev-xyz.99: This is a very long task title that exceeds thirty chars"
      );
      expect(result).toEqual({
        taskId: "opensprint.dev-xyz.99",
        title: "This is a very long task title that exceeds thirty chars",
      });
    });

    it("returns null for non-matching messages", () => {
      expect(parseClosedCommitMessage("beads: closed")).toBeNull();
      expect(parseClosedCommitMessage("prd: updated")).toBeNull();
      expect(parseClosedCommitMessage("Closed opensprint.dev-abc.1")).toBeNull();
      expect(parseClosedCommitMessage("")).toBeNull();
    });

    it("trims whitespace", () => {
      const result = parseClosedCommitMessage("  Closed bd-x.1: Fix typo  ");
      expect(result).toEqual({ taskId: "bd-x.1", title: "Fix typo" });
    });
  });
});
