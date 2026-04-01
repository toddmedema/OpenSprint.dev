/**
 * Server-side line-based diff for PRD/SPEC content.
 * Uses the same algorithm as frontend PrdDiffView (diff library, diffLines with newlineIsToken: true)
 * so results are consistent.
 */

import * as Diff from "diff";
import type { PrdDiffLine, PrdDiffResult } from "@opensprint/shared";
import { PRD_DIFF_MAX_COMBINED_CONTENT_BYTES, PRD_DIFF_MAX_LINE_LIMIT } from "@opensprint/shared";

export type { PrdDiffLine, PrdDiffResult } from "@opensprint/shared";

/**
 * True when paired full-document strings should not be embedded in JSON (combined UTF-8 size cap).
 */
export function isDiffContentPayloadTooLarge(fromContent: string, toContent: string): boolean {
  return (
    Buffer.byteLength(fromContent, "utf8") + Buffer.byteLength(toContent, "utf8") >
    PRD_DIFF_MAX_COMBINED_CONTENT_BYTES
  );
}

/**
 * Returns a window of diff lines plus pagination metadata. Global `summary` is preserved from the full diff.
 */
export function applyDiffPagination(
  full: PrdDiffResult,
  lineOffset: number,
  lineLimit: number
): PrdDiffResult {
  const totalLines = full.lines.length;
  const clampedLimit = Math.min(Math.max(1, lineLimit), PRD_DIFF_MAX_LINE_LIMIT);
  const safeOffset = Math.min(Math.max(0, lineOffset), totalLines);
  const slice = full.lines.slice(safeOffset, safeOffset + clampedLimit);
  return {
    lines: slice,
    summary: full.summary,
    pagination: {
      totalLines,
      offset: safeOffset,
      limit: slice.length,
      hasMore: safeOffset + slice.length < totalLines,
    },
  };
}

/**
 * Splits a chunk value into logical lines. With newlineIsToken: true, trailing \n
 * produces an extra ""; we treat that as "no extra line" so line count matches editors.
 */
function chunkLines(value: string): string[] {
  const lines = value.split("\n");
  if (value.endsWith("\n") && lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Computes a line-based diff between old and new content and returns the shared
 * PrdDiffResult format (lines with type, text, line numbers, and summary).
 * Uses the same diff library and options as PrdDiffView for consistency.
 */
export function computeLineDiff(oldContent: string, newContent: string): PrdDiffResult {
  const parts = Diff.diffLines(oldContent, newContent, { newlineIsToken: true });

  const lines: PrdDiffLine[] = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;
  let additions = 0;
  let deletions = 0;

  for (const part of parts) {
    const lineTexts = chunkLines(part.value);

    if (part.added) {
      for (const text of lineTexts) {
        lines.push({
          type: "add",
          text,
          newLineNumber: newLineNumber++,
        });
        additions++;
      }
    } else if (part.removed) {
      for (const text of lineTexts) {
        lines.push({
          type: "remove",
          text,
          oldLineNumber: oldLineNumber++,
        });
        deletions++;
      }
    } else {
      for (const text of lineTexts) {
        lines.push({
          type: "context",
          text,
          oldLineNumber: oldLineNumber++,
          newLineNumber: newLineNumber++,
        });
      }
    }
  }

  return {
    lines,
    summary: { additions, deletions },
  };
}
