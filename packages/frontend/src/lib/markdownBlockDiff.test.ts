import { describe, it, expect } from "vitest";
import { computeMarkdownBlockDiff } from "./markdownBlockDiff";

describe("computeMarkdownBlockDiff", () => {
  describe("pure additions", () => {
    it("detects a new paragraph added at the end", () => {
      const from = "# Title\n\nFirst paragraph.";
      const to = "# Title\n\nFirst paragraph.\n\nSecond paragraph.";
      const { blocks, parseError } = computeMarkdownBlockDiff(from, to);
      expect(parseError).toBe(false);
      expect(blocks).toHaveLength(3);
      expect(blocks[0].status).toBe("unchanged");
      expect(blocks[1].status).toBe("unchanged");
      expect(blocks[2].status).toBe("added");
      expect(blocks[2].markdown).toContain("Second paragraph");
    });

    it("detects a new heading and paragraph added", () => {
      const from = "# Intro\n\nHello.";
      const to = "# Intro\n\nHello.\n\n## New Section\n\nNew content here.";
      const { blocks } = computeMarkdownBlockDiff(from, to);
      const added = blocks.filter((b) => b.status === "added");
      expect(added.length).toBe(2);
      expect(added[0].nodeType).toBe("heading");
      expect(added[1].nodeType).toBe("paragraph");
    });
  });

  describe("pure removals", () => {
    it("detects a paragraph removed", () => {
      const from = "# Title\n\nFirst.\n\nSecond.\n\nThird.";
      const to = "# Title\n\nFirst.\n\nThird.";
      const { blocks } = computeMarkdownBlockDiff(from, to);
      expect(blocks).toHaveLength(4);
      const removed = blocks.filter((b) => b.status === "removed");
      expect(removed).toHaveLength(1);
      expect(removed[0].markdown).toContain("Second");
    });

    it("detects multiple removed blocks", () => {
      const from = "# A\n\n# B\n\n# C";
      const to = "# A";
      const { blocks } = computeMarkdownBlockDiff(from, to);
      const removed = blocks.filter((b) => b.status === "removed");
      expect(removed).toHaveLength(2);
    });
  });

  describe("word-level changes inside a paragraph", () => {
    it("produces modified status with wordDiff for changed paragraph", () => {
      const from = "# Title\n\nThe quick brown fox jumps.";
      const to = "# Title\n\nThe slow brown fox leaps.";
      const { blocks } = computeMarkdownBlockDiff(from, to);
      expect(blocks[0].status).toBe("unchanged");
      const mod = blocks.find((b) => b.status === "modified");
      expect(mod).toBeDefined();
      expect(mod!.wordDiff).toBeDefined();
      const added = mod!.wordDiff!.filter((p) => p.added);
      const removed = mod!.wordDiff!.filter((p) => p.removed);
      expect(added.length).toBeGreaterThan(0);
      expect(removed.length).toBeGreaterThan(0);
    });

    it("contains the changed words in wordDiff parts", () => {
      const from = "Hello world.";
      const to = "Hello universe.";
      const { blocks } = computeMarkdownBlockDiff(from, to);
      const mod = blocks.find((b) => b.status === "modified");
      expect(mod).toBeDefined();
      const removedText = mod!
        .wordDiff!.filter((p) => p.removed)
        .map((p) => p.value)
        .join("");
      const addedText = mod!
        .wordDiff!.filter((p) => p.added)
        .map((p) => p.value)
        .join("");
      expect(removedText).toContain("world");
      expect(addedText).toContain("universe");
    });
  });

  describe("code blocks", () => {
    it("detects added code block", () => {
      const from = "# Intro";
      const to = "# Intro\n\n```js\nconsole.log('hi');\n```";
      const { blocks } = computeMarkdownBlockDiff(from, to);
      const added = blocks.find((b) => b.status === "added");
      expect(added).toBeDefined();
      expect(added!.nodeType).toBe("code");
    });

    it("detects removed code block", () => {
      const from = "# Intro\n\n```js\nconsole.log('hi');\n```";
      const to = "# Intro";
      const { blocks } = computeMarkdownBlockDiff(from, to);
      const removed = blocks.find((b) => b.status === "removed");
      expect(removed).toBeDefined();
      expect(removed!.nodeType).toBe("code");
    });

    it("detects modified code block with word diff", () => {
      const from = "```js\nconst x = 1;\n```";
      const to = "```js\nconst y = 2;\n```";
      const { blocks } = computeMarkdownBlockDiff(from, to);
      const mod = blocks.find((b) => b.status === "modified");
      expect(mod).toBeDefined();
      expect(mod!.nodeType).toBe("code");
      expect(mod!.wordDiff).toBeDefined();
    });
  });

  describe("list items", () => {
    it("detects added list", () => {
      const from = "# Title";
      const to = "# Title\n\n- item one\n- item two";
      const { blocks } = computeMarkdownBlockDiff(from, to);
      const added = blocks.find((b) => b.status === "added");
      expect(added).toBeDefined();
      expect(added!.nodeType).toBe("list");
    });

    it("detects modified list with word diff", () => {
      const from = "- alpha\n- beta";
      const to = "- alpha\n- gamma";
      const { blocks } = computeMarkdownBlockDiff(from, to);
      const mod = blocks.find((b) => b.status === "modified");
      expect(mod).toBeDefined();
      expect(mod!.nodeType).toBe("list");
      expect(mod!.wordDiff).toBeDefined();
      const addedText = mod!
        .wordDiff!.filter((p) => p.added)
        .map((p) => p.value)
        .join("");
      expect(addedText).toContain("gamma");
    });
  });

  describe("structural type changes", () => {
    it("treats heading-to-paragraph as remove+add (no cross-type word diff)", () => {
      const from = "# Title\n\n## Section A";
      const to = "# Title\n\nSection A is now a paragraph.";
      const { blocks } = computeMarkdownBlockDiff(from, to);
      const hasModified = blocks.some((b) => b.status === "modified");
      expect(hasModified).toBe(false);
      const removed = blocks.filter((b) => b.status === "removed");
      const added = blocks.filter((b) => b.status === "added");
      expect(removed.length).toBeGreaterThan(0);
      expect(added.length).toBeGreaterThan(0);
      expect(removed[0].nodeType).toBe("heading");
      expect(added[0].nodeType).toBe("paragraph");
    });
  });

  describe("identical content", () => {
    it("returns all unchanged blocks for identical input", () => {
      const content = "# Title\n\nParagraph.\n\n- item";
      const { blocks } = computeMarkdownBlockDiff(content, content);
      expect(blocks.every((b) => b.status === "unchanged")).toBe(true);
      expect(blocks.length).toBe(3);
    });
  });

  describe("empty inputs", () => {
    it("handles empty from (all added)", () => {
      const { blocks } = computeMarkdownBlockDiff("", "# New\n\nContent.");
      expect(blocks.every((b) => b.status === "added")).toBe(true);
      expect(blocks.length).toBe(2);
    });

    it("handles empty to (all removed)", () => {
      const { blocks } = computeMarkdownBlockDiff("# Old\n\nContent.", "");
      expect(blocks.every((b) => b.status === "removed")).toBe(true);
      expect(blocks.length).toBe(2);
    });

    it("handles both empty", () => {
      const { blocks } = computeMarkdownBlockDiff("", "");
      expect(blocks).toHaveLength(0);
    });
  });

  describe("performance", () => {
    it("processes ~300 line fixture under 2 seconds", () => {
      const lines: string[] = [];
      for (let i = 0; i < 60; i++) {
        lines.push(`## Section ${i}`);
        lines.push("");
        lines.push(`Paragraph content for section ${i}. This has some text.`);
        lines.push("");
        lines.push(`- list item ${i}a`);
        lines.push(`- list item ${i}b`);
        lines.push("");
      }
      const from = lines.join("\n");
      const toLines = [...lines];
      toLines[2] = "Paragraph content for section 0. This has CHANGED text.";
      toLines.push("## New Final Section\n\nAdded at the end.");
      const to = toLines.join("\n");

      const start = performance.now();
      const { blocks, parseError } = computeMarkdownBlockDiff(from, to);
      const elapsed = performance.now() - start;

      expect(parseError).toBe(false);
      expect(blocks.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(2000);
    });
  });
});
