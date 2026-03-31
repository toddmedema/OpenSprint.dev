import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sharedRoot = resolve(__dirname, "../..");
const repoRoot = resolve(sharedRoot, "../..");
const scriptPath = resolve(repoRoot, "scripts/affected-workspaces.mjs");

// Dynamic import because the script is .mjs
const mod = await import(scriptPath);
const computeWorkspacesFromFiles: (
  changedFiles: string[],
  options?: { coverageOnly?: boolean }
) => { workspaces: string[]; reason: string } = mod.computeWorkspacesFromFiles;

describe("computeWorkspacesFromFiles", () => {
  describe("without coverageOnly", () => {
    it("returns backend for packages/backend/ changes", () => {
      const result = computeWorkspacesFromFiles(["packages/backend/src/index.ts"]);
      expect(result.workspaces).toEqual(["backend"]);
      expect(result.reason).toBe("git-diff");
    });

    it("returns frontend for packages/frontend/ changes", () => {
      const result = computeWorkspacesFromFiles(["packages/frontend/src/App.tsx"]);
      expect(result.workspaces).toEqual(["frontend"]);
      expect(result.reason).toBe("git-diff");
    });

    it("returns electron for packages/electron/ changes", () => {
      const result = computeWorkspacesFromFiles(["packages/electron/main.ts"]);
      expect(result.workspaces).toEqual(["electron"]);
      expect(result.reason).toBe("git-diff");
    });

    it("returns all workspaces for shared changes", () => {
      const result = computeWorkspacesFromFiles(["packages/shared/src/types.ts"]);
      expect(result.workspaces).toEqual(["shared", "backend", "frontend", "electron"]);
      expect(result.reason).toBe("git-diff");
    });

    it("returns all workspaces for always-all prefix files", () => {
      const result = computeWorkspacesFromFiles([".github/workflows/ci.yml"]);
      expect(result.workspaces).toEqual(["shared", "backend", "frontend", "electron"]);
      expect(result.reason).toBe("git-diff");
    });

    it("returns empty list for unmapped files when no other changes", () => {
      const result = computeWorkspacesFromFiles(["README.md"]);
      expect(result.workspaces).toEqual([]);
      expect(result.reason).toBe("git-diff");
    });

    it("returns empty list and git-diff reason for no changed files", () => {
      const result = computeWorkspacesFromFiles([]);
      expect(result.workspaces).toEqual([]);
      expect(result.reason).toBe("git-diff");
    });
  });

  describe("with coverageOnly", () => {
    it("filters electron from coverage workspaces", () => {
      const result = computeWorkspacesFromFiles(["packages/shared/src/types.ts"], {
        coverageOnly: true,
      });
      expect(result.workspaces).toEqual(["shared", "backend", "frontend"]);
      expect(result.reason).toBe("git-diff");
    });

    it("returns backend only for backend changes", () => {
      const result = computeWorkspacesFromFiles(["packages/backend/src/index.ts"], {
        coverageOnly: true,
      });
      expect(result.workspaces).toEqual(["backend"]);
      expect(result.reason).toBe("git-diff");
    });

    it("falls back to all coverage workspaces for electron-only changes", () => {
      const result = computeWorkspacesFromFiles(["packages/electron/main.ts"], {
        coverageOnly: true,
      });
      expect(result.workspaces).toEqual(["shared", "backend", "frontend"]);
      expect(result.reason).toBe("coverage-fallback");
    });

    it("falls back to all coverage workspaces for unmapped file changes", () => {
      const result = computeWorkspacesFromFiles(["README.md"], { coverageOnly: true });
      expect(result.workspaces).toEqual(["shared", "backend", "frontend"]);
      expect(result.reason).toBe("coverage-fallback");
    });

    it("falls back for mix of unmapped and electron-only files", () => {
      const result = computeWorkspacesFromFiles(
        ["packages/electron/main.ts", "docs/guide.md", "CONTRIBUTING.md"],
        { coverageOnly: true }
      );
      expect(result.workspaces).toEqual(["shared", "backend", "frontend"]);
      expect(result.reason).toBe("coverage-fallback");
    });

    it("does not fall back when no files changed", () => {
      const result = computeWorkspacesFromFiles([], { coverageOnly: true });
      expect(result.workspaces).toEqual([]);
      expect(result.reason).toBe("git-diff");
    });

    it("does not fall back when coverage workspaces are already present", () => {
      const result = computeWorkspacesFromFiles(
        ["packages/electron/main.ts", "packages/backend/src/index.ts"],
        { coverageOnly: true }
      );
      expect(result.workspaces).toEqual(["backend"]);
      expect(result.reason).toBe("git-diff");
    });

    it("includes all affected coverage workspaces when mixed", () => {
      const result = computeWorkspacesFromFiles(
        ["packages/frontend/src/App.tsx", "packages/backend/src/api.ts"],
        { coverageOnly: true }
      );
      expect(result.workspaces).toEqual(["backend", "frontend"]);
      expect(result.reason).toBe("git-diff");
    });
  });
});

describe("merge-gate workflow coverage-fallback annotation", () => {
  it("outputs the affected workspace reason for coverage-fallback detection", () => {
    const workflow = readFileSync(
      resolve(repoRoot, ".github/workflows/merge-gate.yml"),
      "utf-8"
    );
    expect(workflow).toContain('reason=$REASON');
    expect(workflow).toContain('"$REASON" = "coverage-fallback"');
  });
});
