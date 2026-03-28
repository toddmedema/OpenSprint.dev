import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

vi.mock("../services/project.service.js", () => ({
  ProjectService: vi.fn().mockImplementation(() => ({
    getRepoPath: vi.fn(),
    getSettings: vi.fn(),
  })),
}));

vi.mock("../services/branch-manager.js", () => ({
  BranchManager: vi.fn().mockImplementation(() => ({
    getWorktreePath: vi.fn(),
  })),
}));

vi.mock("../services/orchestrator.service.js", () => ({
  orchestratorService: {
    getStatus: vi.fn(),
  },
}));

vi.mock("../services/global-settings.service.js", () => ({
  getGlobalSettings: vi.fn(),
}));

const { ProjectService } = await import("../services/project.service.js");
const { BranchManager } = await import("../services/branch-manager.js");
const { orchestratorService } = await import("../services/orchestrator.service.js");
const { getGlobalSettings } = await import("../services/global-settings.service.js");
const { resolveOpenEditor, isCliAvailable, resolveEditor } = await import(
  "../services/open-editor.service.js"
);

describe("open-editor.service", () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "open-editor-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  function setupMocks(overrides: {
    repoPath?: string;
    gitWorkingMode?: "worktree" | "branches";
    activeTasks?: Array<{ taskId: string; worktreePath?: string | null; [k: string]: unknown }>;
    branchWorktreePath?: string;
    preferredEditor?: "vscode" | "cursor" | "auto";
  }) {
    const defaults = {
      repoPath: tmpDir,
      gitWorkingMode: "worktree" as const,
      activeTasks: [
        {
          taskId: "os-1234",
          phase: "coding",
          startedAt: new Date().toISOString(),
          state: "running",
          worktreePath: tmpDir,
        },
      ],
      branchWorktreePath: tmpDir,
      preferredEditor: "auto" as const,
      ...overrides,
    };

    const projInstance = {
      getRepoPath: vi.fn().mockResolvedValue(defaults.repoPath),
      getSettings: vi.fn().mockResolvedValue({ gitWorkingMode: defaults.gitWorkingMode }),
    };
    vi.mocked(ProjectService).mockImplementation(() => projInstance as never);

    const branchInstance = {
      getWorktreePath: vi.fn().mockReturnValue(defaults.branchWorktreePath),
    };
    vi.mocked(BranchManager).mockImplementation(() => branchInstance as never);

    vi.mocked(orchestratorService.getStatus).mockResolvedValue({
      activeTasks: defaults.activeTasks as never,
      queueDepth: 0,
      totalDone: 0,
      totalFailed: 0,
    });

    vi.mocked(getGlobalSettings).mockResolvedValue({
      preferredEditor: defaults.preferredEditor,
    });

    return { projInstance, branchInstance };
  }

  describe("resolveOpenEditor", () => {
    it("returns worktree path and editor when task is actively executing", async () => {
      setupMocks({ repoPath: tmpDir, activeTasks: [{ taskId: "os-1234", worktreePath: tmpDir, phase: "coding", startedAt: new Date().toISOString(), state: "running" }] });

      const result = await resolveOpenEditor("proj-1", "os-1234");

      expect(result.worktreePath).toBe(tmpDir);
      expect(result.opened).toBe(true);
      expect(["vscode", "cursor", "none"]).toContain(result.editor);
    });

    it("throws 409 when task is not currently executing", async () => {
      setupMocks({ activeTasks: [] });

      await expect(resolveOpenEditor("proj-1", "os-missing")).rejects.toThrow(
        /not currently executing/i
      );
      await expect(resolveOpenEditor("proj-1", "os-missing")).rejects.toMatchObject({
        statusCode: 409,
        code: "TASK_NOT_EXECUTING",
      });
    });

    it("throws 404 when worktree path does not exist on disk", async () => {
      const fakePath = path.join(tmpDir, "nonexistent");
      setupMocks({ activeTasks: [{ taskId: "os-1234", worktreePath: fakePath, phase: "coding", startedAt: new Date().toISOString(), state: "running" }] });

      await expect(resolveOpenEditor("proj-1", "os-1234")).rejects.toThrow(
        /does not exist/i
      );
      await expect(resolveOpenEditor("proj-1", "os-1234")).rejects.toMatchObject({
        statusCode: 404,
        code: "WORKTREE_NOT_FOUND",
      });
    });

    it("returns repo root in branches mode", async () => {
      setupMocks({
        gitWorkingMode: "branches",
        repoPath: tmpDir,
        activeTasks: [{ taskId: "os-1234", worktreePath: "/some/other/path", phase: "coding", startedAt: new Date().toISOString(), state: "running" }],
      });

      const result = await resolveOpenEditor("proj-1", "os-1234");

      expect(result.worktreePath).toBe(tmpDir);
      expect(result.opened).toBe(true);
    });

    it("falls back to BranchManager.getWorktreePath when activeEntry has no worktreePath", async () => {
      const { branchInstance } = setupMocks({
        gitWorkingMode: "worktree",
        activeTasks: [{ taskId: "os-1234", worktreePath: null, phase: "coding", startedAt: new Date().toISOString(), state: "running" }],
        branchWorktreePath: tmpDir,
      });

      const result = await resolveOpenEditor("proj-1", "os-1234");

      expect(branchInstance.getWorktreePath).toHaveBeenCalledWith("os-1234");
      expect(result.worktreePath).toBe(tmpDir);
      expect(result.opened).toBe(true);
    });
  });

  describe("isCliAvailable", () => {
    it("returns true for a command that exists", async () => {
      const result = await isCliAvailable("node");
      expect(result).toBe(true);
    });

    it("returns false for a command that does not exist", async () => {
      const result = await isCliAvailable("this-command-definitely-does-not-exist-xyz123");
      expect(result).toBe(false);
    });
  });

  describe("resolveEditor", () => {
    it("returns a valid editor value for auto mode", async () => {
      const result = await resolveEditor("auto");
      expect(["vscode", "cursor", "none"]).toContain(result);
    });

    it("returns a valid editor value for vscode preference", async () => {
      const result = await resolveEditor("vscode");
      expect(["vscode", "none"]).toContain(result);
    });

    it("returns a valid editor value for cursor preference", async () => {
      const result = await resolveEditor("cursor");
      expect(["cursor", "none"]).toContain(result);
    });

    it("treats undefined as auto", async () => {
      const result = await resolveEditor(undefined);
      expect(["vscode", "cursor", "none"]).toContain(result);
    });
  });
});
