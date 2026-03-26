import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  OrchestratorStatusService,
  buildReviewAgentId,
  type StateForStatus,
  type SlotForStatus,
} from "../services/orchestrator-status.service.js";

const mockTaskStore = {
  runWrite: vi.fn().mockResolvedValue(undefined),
  getDb: vi.fn().mockResolvedValue({
    queryOne: vi.fn().mockResolvedValue(undefined),
  }),
};
const mockProjectService = {
  getProjectByRepoPath: vi.fn().mockResolvedValue({ id: "proj-1" }),
};

describe("OrchestratorStatusService", () => {
  let statusService: OrchestratorStatusService;

  beforeEach(() => {
    vi.clearAllMocks();
    statusService = new OrchestratorStatusService(
      mockTaskStore as never,
      mockProjectService as never
    );
  });

  describe("buildActiveTasks", () => {
    it("returns one entry per coding slot", () => {
      const state: StateForStatus = {
        slots: new Map([
          [
            "task-1",
            {
              taskId: "task-1",
              taskTitle: "Task one",
              phase: "coding",
              agent: {
                startedAt: "2025-01-01T00:00:00Z",
                lifecycleState: "running",
              },
            } as SlotForStatus,
          ],
        ]),
        status: { queueDepth: 0, totalDone: 0, totalFailed: 0 },
      };
      const tasks = statusService.buildActiveTasks(state);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        taskId: "task-1",
        phase: "coding",
        state: "running",
        worktreePath: null,
      });
    });

    it("includes worktreePath on each active task entry when slot has a path", () => {
      const state: StateForStatus = {
        slots: new Map([
          [
            "task-1",
            {
              taskId: "task-1",
              taskTitle: "Task one",
              worktreePath: "/tmp/wt/os-1",
              phase: "coding",
              agent: {
                startedAt: "2025-01-01T00:00:00Z",
                lifecycleState: "running",
              },
            } as SlotForStatus,
          ],
        ]),
        status: { queueDepth: 0, totalDone: 0, totalFailed: 0 },
      };
      const tasks = statusService.buildActiveTasks(state);
      expect(tasks[0]?.worktreePath).toBe("/tmp/wt/os-1");
    });

    it("returns one entry per review sub-agent when multi-angle", () => {
      const state: StateForStatus = {
        slots: new Map([
          [
            "task-1",
            {
              taskId: "task-1",
              taskTitle: null,
              phase: "review",
              agent: { startedAt: "2025-01-01T00:00:00Z", lifecycleState: "running" },
              reviewAgents: new Map([
                [
                  "security",
                  {
                    angle: "security",
                    agent: {
                      startedAt: "2025-01-01T00:00:00Z",
                      lifecycleState: "running",
                    },
                  },
                ],
              ]),
            } as SlotForStatus,
          ],
        ]),
        status: { queueDepth: 0, totalDone: 0, totalFailed: 0 },
      };
      const tasks = statusService.buildActiveTasks(state);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        taskId: "task-1",
        phase: "review",
        id: "task-1--review--security",
        name: "Reviewer (Security)",
        worktreePath: null,
      });
    });

    it("sets worktreePath to null when slot has no worktreePath", () => {
      const state: StateForStatus = {
        slots: new Map([
          [
            "task-1",
            {
              taskId: "task-1",
              taskTitle: "Task one",
              phase: "coding",
              agent: {
                startedAt: "2025-01-01T00:00:00Z",
                lifecycleState: "running",
              },
            } as SlotForStatus,
          ],
        ]),
        status: { queueDepth: 0, totalDone: 0, totalFailed: 0 },
      };
      const tasks = statusService.buildActiveTasks(state);
      expect(tasks[0]?.worktreePath).toBeNull();
    });

    it("populates worktreePath on review sub-agent entries from slot", () => {
      const state: StateForStatus = {
        slots: new Map([
          [
            "task-1",
            {
              taskId: "task-1",
              taskTitle: null,
              worktreePath: "/tmp/wt/os-1",
              phase: "review",
              agent: { startedAt: "2025-01-01T00:00:00Z", lifecycleState: "running" },
              reviewAgents: new Map([
                [
                  "security",
                  {
                    angle: "security",
                    agent: {
                      startedAt: "2025-01-01T00:00:00Z",
                      lifecycleState: "running",
                    },
                  },
                ],
                [
                  "performance",
                  {
                    angle: "performance",
                    agent: {
                      startedAt: "2025-01-01T00:00:00Z",
                      lifecycleState: "running",
                    },
                  },
                ],
              ]),
            } as SlotForStatus,
          ],
        ]),
        status: { queueDepth: 0, totalDone: 0, totalFailed: 0 },
      };
      const tasks = statusService.buildActiveTasks(state);
      expect(tasks).toHaveLength(2);
      for (const entry of tasks) {
        expect(entry.worktreePath).toBe("/tmp/wt/os-1");
      }
    });

    it("every active task entry always has worktreePath property (string or null)", () => {
      const state: StateForStatus = {
        slots: new Map([
          [
            "task-1",
            {
              taskId: "task-1",
              taskTitle: "With path",
              worktreePath: "/tmp/wt/os-1",
              phase: "coding",
              agent: { startedAt: "2025-01-01T00:00:00Z", lifecycleState: "running" },
            } as SlotForStatus,
          ],
          [
            "task-2",
            {
              taskId: "task-2",
              taskTitle: "No path",
              phase: "coding",
              agent: { startedAt: "2025-01-01T00:00:00Z", lifecycleState: "running" },
            } as SlotForStatus,
          ],
        ]),
        status: { queueDepth: 0, totalDone: 0, totalFailed: 0 },
      };
      const tasks = statusService.buildActiveTasks(state);
      expect(tasks).toHaveLength(2);
      for (const entry of tasks) {
        expect(entry).toHaveProperty("worktreePath");
        expect(typeof entry.worktreePath === "string" || entry.worktreePath === null).toBe(true);
      }
      expect(tasks.find((t) => t.taskId === "task-1")?.worktreePath).toBe("/tmp/wt/os-1");
      expect(tasks.find((t) => t.taskId === "task-2")?.worktreePath).toBeNull();
    });
  });

  describe("buildReviewAgentId", () => {
    it("returns stable id for task and angle", () => {
      expect(buildReviewAgentId("os-abc", "security")).toBe("os-abc--review--security");
      expect(buildReviewAgentId("os-123", "code_quality")).toBe("os-123--review--code_quality");
    });
  });

  describe("counter persistence", () => {
    it("persists merge validation health fields", async () => {
      const execute = vi.fn().mockResolvedValue(undefined);
      mockTaskStore.runWrite.mockImplementationOnce(
        async (fn: (client: { execute: typeof execute }) => Promise<void>) => {
          await fn({ execute });
        }
      );

      const state: StateForStatus = {
        slots: new Map(),
        status: {
          queueDepth: 3,
          totalDone: 4,
          totalFailed: 2,
          baselineStatus: "healthy",
          baselineCheckedAt: "2026-03-19T22:00:00.000Z",
          baselineFailureSummary: null,
          mergeValidationStatus: "degraded",
          mergeValidationFailureSummary: "Merge validation environment issues detected",
          dispatchPausedReason: null,
        },
      };

      await statusService.persistCounters("proj-1", "/tmp/repo", state);

      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining("merge_validation_status"),
        expect.arrayContaining(["degraded", "Merge validation environment issues detected"])
      );
    });

    it("loads merge validation health fields from persisted counters", async () => {
      mockTaskStore.getDb.mockResolvedValueOnce({
        queryOne: vi.fn().mockResolvedValue({
          total_done: 4,
          total_failed: 2,
          queue_depth: 3,
          baseline_status: "healthy",
          baseline_checked_at: "2026-03-19T22:00:00.000Z",
          baseline_failure_summary: null,
          merge_validation_status: "degraded",
          merge_validation_failure_summary: "Merge validation environment issues detected",
          dispatch_paused_reason: null,
        }),
      });

      await expect(statusService.loadCounters("/tmp/repo")).resolves.toMatchObject({
        totalDone: 4,
        totalFailed: 2,
        queueDepth: 3,
        baselineStatus: "healthy",
        mergeValidationStatus: "degraded",
        mergeValidationFailureSummary: "Merge validation environment issues detected",
      });
    });
  });
});
