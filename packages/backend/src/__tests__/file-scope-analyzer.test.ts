import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileScopeAnalyzer, type FileScope } from "../services/file-scope-analyzer.js";

function makeIssue(id: string, labels: string[] = [], title = "", description = "") {
  return {
    id,
    title,
    description,
    labels,
    status: "open",
    priority: 2,
    issue_type: "task",
    type: "task",
    assignee: null,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
}

describe("FileScopeAnalyzer", () => {
  let analyzer: FileScopeAnalyzer;
  let mockBeads: {
    show: ReturnType<typeof vi.fn>;
    getBlockers: ReturnType<typeof vi.fn>;
    addLabel: ReturnType<typeof vi.fn>;
    removeLabel: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    analyzer = new FileScopeAnalyzer();
    mockBeads = {
      show: vi.fn(),
      getBlockers: vi.fn().mockResolvedValue([]),
      addLabel: vi.fn().mockResolvedValue(undefined),
      removeLabel: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe("predict", () => {
    it("returns explicit confidence when files: label exists", async () => {
      const task = makeIssue("t1", [
        'files:{"modify":["src/api/user.ts"],"create":["src/api/auth.ts"]}',
      ]);
      const scope = await analyzer.predict("/repo", task as any, mockBeads as any);

      expect(scope.confidence).toBe("explicit");
      expect(scope.files).toEqual(new Set(["src/api/user.ts", "src/api/auth.ts"]));
      expect(scope.directories).toEqual(new Set(["src/api"]));
    });

    it("falls back to inferred from dependency actual_files", async () => {
      const task = makeIssue("t2");
      mockBeads.getBlockers.mockResolvedValue(["dep-1"]);
      mockBeads.show.mockResolvedValue(
        makeIssue("dep-1", ['actual_files:["src/models/user.ts","src/models/index.ts"]'])
      );

      const scope = await analyzer.predict("/repo", task as any, mockBeads as any);

      expect(scope.confidence).toBe("inferred");
      expect(scope.files.has("src/models/user.ts")).toBe(true);
      expect(scope.files.has("src/models/index.ts")).toBe(true);
    });

    it("falls back to heuristic from task title", async () => {
      const task = makeIssue("t3", [], "Add user service in src/services directory");

      const scope = await analyzer.predict("/repo", task as any, mockBeads as any);

      expect(scope.confidence).toBe("heuristic");
      expect(scope.directories.has("src/services")).toBe(true);
    });

    it("returns heuristic with empty sets when no info available", async () => {
      const task = makeIssue("t4", [], "Fix the bug");

      const scope = await analyzer.predict("/repo", task as any, mockBeads as any);

      expect(scope.confidence).toBe("heuristic");
      expect(scope.files.size).toBe(0);
    });
  });

  describe("recordActual", () => {
    it("stores actual files as label", async () => {
      await analyzer.recordActual("/repo", "t1", ["src/a.ts", "src/b.ts"], mockBeads as any);

      expect(mockBeads.addLabel).toHaveBeenCalledWith(
        "/repo",
        "t1",
        'actual_files:["src/a.ts","src/b.ts"]'
      );
    });

    it("does nothing for empty file list", async () => {
      await analyzer.recordActual("/repo", "t1", [], mockBeads as any);

      expect(mockBeads.addLabel).not.toHaveBeenCalled();
    });
  });

  describe("overlaps", () => {
    const makeScope = (
      files: string[],
      dirs: string[],
      confidence: FileScope["confidence"]
    ): FileScope => ({
      taskId: "test",
      files: new Set(files),
      directories: new Set(dirs),
      confidence,
    });

    it("detects file-level overlap", () => {
      const a = makeScope(["src/a.ts"], ["src"], "explicit");
      const b = makeScope(["src/a.ts", "src/b.ts"], ["src"], "explicit");

      expect(analyzer.overlaps(a, b)).toBe(true);
    });

    it("no overlap when files are disjoint", () => {
      const a = makeScope(["src/a.ts"], ["src"], "explicit");
      const b = makeScope(["lib/b.ts"], ["lib"], "explicit");

      expect(analyzer.overlaps(a, b)).toBe(false);
    });

    it("detects directory overlap when at least one is heuristic", () => {
      const a = makeScope([], ["src/components"], "heuristic");
      const b = makeScope(["src/components/Button.tsx"], ["src/components"], "explicit");

      expect(analyzer.overlaps(a, b)).toBe(true);
    });

    it("detects nested directory overlap", () => {
      const a = makeScope([], ["src"], "heuristic");
      const b = makeScope([], ["src/services"], "heuristic");

      expect(analyzer.overlaps(a, b)).toBe(true);
    });

    it("no overlap between unrelated directories", () => {
      const a = makeScope([], ["src/frontend"], "heuristic");
      const b = makeScope([], ["src/backend"], "heuristic");

      expect(analyzer.overlaps(a, b)).toBe(false);
    });

    it("empty scopes do not overlap", () => {
      const a = makeScope([], [], "heuristic");
      const b = makeScope([], [], "heuristic");

      expect(analyzer.overlaps(a, b)).toBe(false);
    });
  });
});
