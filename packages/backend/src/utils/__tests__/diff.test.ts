import { describe, it, expect } from "vitest";
import { computeLineDiff } from "../diff.js";

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

  it("mixed: context, additions, and deletions", () => {
    const oldContent = "first\nsecond\nthird\n";
    const newContent = "first\nmodified\nthird\nfourth\n";
    const result = computeLineDiff(oldContent, newContent);

    expect(result.summary).toEqual({ additions: 2, deletions: 1 });

    const contextLines = result.lines.filter((l) => l.type === "context");
    const addLines = result.lines.filter((l) => l.type === "add");
    const removeLines = result.lines.filter((l) => l.type === "remove");

    expect(contextLines.length).toBeGreaterThanOrEqual(2); // first, third
    expect(removeLines).toContainEqual(expect.objectContaining({ type: "remove", text: "second" }));
    expect(addLines).toContainEqual(expect.objectContaining({ type: "add", text: "modified" }));
    expect(addLines).toContainEqual(expect.objectContaining({ type: "add", text: "fourth" }));
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
