import { describe, it, expect } from "vitest";
import { applyDiffPagination, computeLineDiff, isDiffContentPayloadTooLarge } from "../diff.js";
import { PRD_DIFF_MAX_COMBINED_CONTENT_BYTES } from "@opensprint/shared";

describe("computeLineDiff", () => {
  it("additions only: old empty, new has lines", () => {
    const oldContent = "";
    const newContent = "line1\nline2\nline3\n";
    const result = computeLineDiff(oldContent, newContent);

    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]).toEqual({
      type: "add",
      text: "line1",
      newLineNumber: 1,
    });
    expect(result.lines[1]).toEqual({
      type: "add",
      text: "line2",
      newLineNumber: 2,
    });
    expect(result.lines[2]).toEqual({
      type: "add",
      text: "line3",
      newLineNumber: 3,
    });
    expect(result.summary).toEqual({ additions: 3, deletions: 0 });
  });

  it("deletions only: old has lines, new empty", () => {
    const oldContent = "a\nb\nc\n";
    const newContent = "";
    const result = computeLineDiff(oldContent, newContent);

    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]).toEqual({
      type: "remove",
      text: "a",
      oldLineNumber: 1,
    });
    expect(result.lines[1]).toEqual({
      type: "remove",
      text: "b",
      oldLineNumber: 2,
    });
    expect(result.lines[2]).toEqual({
      type: "remove",
      text: "c",
      oldLineNumber: 3,
    });
    expect(result.summary).toEqual({ additions: 0, deletions: 3 });
  });

  it("mixed: context, additions, and deletions (deterministic order and line numbers)", () => {
    const oldContent = "first\nsecond\nthird\n";
    const newContent = "first\nmodified\nthird\nfourth\n";
    const result = computeLineDiff(oldContent, newContent);

    expect(result.summary).toEqual({ additions: 2, deletions: 1 });
    // newlineIsToken: true can emit a blank context row between changed and following lines; lock full shape.
    expect(result.lines).toEqual([
      { type: "context", text: "first", oldLineNumber: 1, newLineNumber: 1 },
      { type: "remove", text: "second", oldLineNumber: 2 },
      { type: "add", text: "modified", newLineNumber: 2 },
      { type: "context", text: "", oldLineNumber: 3, newLineNumber: 3 },
      { type: "context", text: "third", oldLineNumber: 4, newLineNumber: 4 },
      { type: "add", text: "fourth", newLineNumber: 5 },
    ]);
  });

  it("deterministic: repeated calls return identical payloads", () => {
    const a = "x\ny\n";
    const b = "x\nz\n";
    expect(JSON.stringify(computeLineDiff(a, b))).toBe(JSON.stringify(computeLineDiff(a, b)));
  });

  it("large input: completes without throwing and reports expected change", () => {
    const n = 8000;
    const oldContent = Array.from({ length: n }, (_, i) => `line-${i}`).join("\n") + "\n";
    const newContent =
      Array.from({ length: n }, (_, i) => (i === 4000 ? "changed" : `line-${i}`)).join("\n") + "\n";
    expect(() => computeLineDiff(oldContent, newContent)).not.toThrow();
    const result = computeLineDiff(oldContent, newContent);
    expect(result.summary).toEqual({ additions: 1, deletions: 1 });
    expect(result.lines.some((l) => l.type === "add" && l.text === "changed")).toBe(true);
    expect(result.lines.some((l) => l.type === "remove" && l.text === "line-4000")).toBe(true);
  });

  it("no trailing newline: single line add and remove", () => {
    expect(computeLineDiff("", "only")).toEqual({
      lines: [{ type: "add", text: "only", newLineNumber: 1 }],
      summary: { additions: 1, deletions: 0 },
    });
    expect(computeLineDiff("only", "")).toEqual({
      lines: [{ type: "remove", text: "only", oldLineNumber: 1 }],
      summary: { additions: 0, deletions: 1 },
    });
  });

  it("empty: both inputs empty", () => {
    const result = computeLineDiff("", "");

    expect(result.lines).toHaveLength(0);
    expect(result.summary).toEqual({ additions: 0, deletions: 0 });
  });

  it("identical content: no additions or deletions", () => {
    const content = "same\nlines\nhere\n";
    const result = computeLineDiff(content, content);

    expect(result.lines).toHaveLength(3);
    result.lines.forEach((line) => {
      expect(line.type).toBe("context");
      expect(line.oldLineNumber).toBe(line.newLineNumber);
    });
    expect(result.lines[0]).toEqual({
      type: "context",
      text: "same",
      oldLineNumber: 1,
      newLineNumber: 1,
    });
    expect(result.summary).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("applyDiffPagination", () => {
  it("returns first window and hasMore when more lines exist", () => {
    const full = computeLineDiff("a\nb\nc\nd\n", "a\nx\nc\nd\n");
    const page = applyDiffPagination(full, 0, 2);
    expect(page.lines).toHaveLength(2);
    expect(page.summary).toEqual(full.summary);
    expect(page.pagination).toEqual({
      totalLines: full.lines.length,
      offset: 0,
      limit: 2,
      hasMore: true,
    });
  });

  it("offsets into the diff and clears hasMore on last page", () => {
    const full = computeLineDiff("a\nb\nc\n", "x\nb\nc\n");
    const start = applyDiffPagination(full, 0, 2);
    const rest = applyDiffPagination(full, start.pagination!.offset + start.pagination!.limit, 50);
    expect(rest.pagination!.hasMore).toBe(false);
    expect(rest.pagination!.offset + rest.pagination!.limit).toBe(full.lines.length);
  });

  it("clamps offset past end to empty slice", () => {
    const full = computeLineDiff("one\n", "two\n");
    const page = applyDiffPagination(full, 999, 10);
    expect(page.lines).toHaveLength(0);
    expect(page.pagination?.hasMore).toBe(false);
    expect(page.pagination?.totalLines).toBe(full.lines.length);
  });
});

describe("isDiffContentPayloadTooLarge", () => {
  it("returns false for small strings", () => {
    expect(isDiffContentPayloadTooLarge("hello", "world")).toBe(false);
  });

  it("returns true when combined UTF-8 bytes exceed cap", () => {
    const half = Math.ceil(PRD_DIFF_MAX_COMBINED_CONTENT_BYTES / 2) + 1;
    const a = "x".repeat(half);
    const b = "y".repeat(half);
    expect(isDiffContentPayloadTooLarge(a, b)).toBe(true);
  });
});
