import { describe, it, expect, vi, beforeEach } from "vitest";
import { runNightlyTick, startNightlyDeployScheduler, stopNightlyDeployScheduler } from "../services/nightly-deploy-scheduler.service.js";

const { mockListProjects, mockGetSettings, mockTriggerDeploy } = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
  mockGetSettings: vi.fn(),
  mockTriggerDeploy: vi.fn(),
}));

vi.mock("../services/project.service.js", () => ({
  ProjectService: vi.fn().mockImplementation(() => ({
    listProjects: mockListProjects,
    getSettings: mockGetSettings,
  })),
}));

vi.mock("../services/deploy-trigger.service.js", () => ({
  triggerDeploy: (...args: unknown[]) => mockTriggerDeploy(...args),
}));

describe("nightly-deploy-scheduler.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopNightlyDeployScheduler();
  });

  describe("runNightlyTick", () => {
    it("triggers deploy for projects with nightly targets when time matches", async () => {
      mockListProjects.mockResolvedValue([
        { id: "proj-1", name: "Project One" },
      ]);
      mockGetSettings.mockResolvedValue({
        deployment: {
          mode: "custom",
          targets: [
            { name: "staging", autoDeployTrigger: "nightly" },
            { name: "production", autoDeployTrigger: "none" },
          ],
          nightlyDeployTime: "02:00",
        },
      });
      mockTriggerDeploy.mockResolvedValue("deploy-123");

      const now = new Date(2025, 1, 15, 2, 0, 0); // Feb 15, 2025 02:00 local
      const results = await runNightlyTick(now);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        projectId: "proj-1",
        targetName: "staging",
        deployId: "deploy-123",
      });
      expect(mockTriggerDeploy).toHaveBeenCalledWith("proj-1", "staging");
    });

    it("uses default 02:00 when nightlyDeployTime is not set", async () => {
      mockListProjects.mockResolvedValue([
        { id: "proj-1", name: "Project One" },
      ]);
      mockGetSettings.mockResolvedValue({
        deployment: {
          mode: "custom",
          targets: [{ name: "staging", autoDeployTrigger: "nightly" }],
        },
      });
      mockTriggerDeploy.mockResolvedValue("deploy-456");

      const now = new Date(2025, 1, 20, 2, 0, 0); // Feb 20, 2025 02:00 local
      const results = await runNightlyTick(now);

      expect(results).toHaveLength(1);
      expect(mockTriggerDeploy).toHaveBeenCalledWith("proj-1", "staging");
    });

    it("does not trigger when current time does not match nightlyDeployTime", async () => {
      mockListProjects.mockResolvedValue([
        { id: "proj-1", name: "Project One" },
      ]);
      mockGetSettings.mockResolvedValue({
        deployment: {
          mode: "custom",
          targets: [{ name: "staging", autoDeployTrigger: "nightly" }],
          nightlyDeployTime: "03:30",
        },
      });

      const now = new Date(2025, 1, 15, 2, 0, 0); // 02:00, but config says 03:30
      const results = await runNightlyTick(now);

      expect(results).toHaveLength(0);
      expect(mockTriggerDeploy).not.toHaveBeenCalled();
    });

    it("triggers for custom time 03:30 when time matches", async () => {
      mockListProjects.mockResolvedValue([
        { id: "proj-1", name: "Project One" },
      ]);
      mockGetSettings.mockResolvedValue({
        deployment: {
          mode: "custom",
          targets: [
            { name: "staging", autoDeployTrigger: "nightly" },
            { name: "production", autoDeployTrigger: "nightly" },
          ],
          nightlyDeployTime: "03:30",
        },
      });
      mockTriggerDeploy
        .mockResolvedValueOnce("deploy-1")
        .mockResolvedValueOnce("deploy-2");

      const now = new Date(2025, 1, 15, 3, 30, 0); // Feb 15, 2025 03:30 local
      const results = await runNightlyTick(now);

      expect(results).toHaveLength(2);
      expect(mockTriggerDeploy).toHaveBeenNthCalledWith(1, "proj-1", "staging");
      expect(mockTriggerDeploy).toHaveBeenNthCalledWith(2, "proj-1", "production");
    });

    it("skips projects with no nightly targets", async () => {
      mockListProjects.mockResolvedValue([
        { id: "proj-1", name: "Project One" },
      ]);
      mockGetSettings.mockResolvedValue({
        deployment: {
          mode: "custom",
          targets: [
            { name: "staging", autoDeployTrigger: "each_task" },
            { name: "production", autoDeployTrigger: "none" },
          ],
          nightlyDeployTime: "02:00",
        },
      });

      const now = new Date(2025, 1, 15, 2, 0, 0);
      const results = await runNightlyTick(now);

      expect(results).toHaveLength(0);
      expect(mockTriggerDeploy).not.toHaveBeenCalled();
    });

    it("runs at most once per day per project", async () => {
      mockListProjects.mockResolvedValue([
        { id: "proj-once-per-day", name: "Project Once" },
      ]);
      mockGetSettings.mockResolvedValue({
        deployment: {
          mode: "custom",
          targets: [{ name: "staging", autoDeployTrigger: "nightly" }],
          nightlyDeployTime: "02:00",
        },
      });
      mockTriggerDeploy.mockResolvedValue("deploy-123");

      const now = new Date(2025, 5, 10, 2, 0, 0); // Jun 10, 2025 02:00
      const results1 = await runNightlyTick(now);
      const results2 = await runNightlyTick(now); // Same time, same day

      expect(results1).toHaveLength(1);
      expect(results2).toHaveLength(0); // Already ran today
      expect(mockTriggerDeploy).toHaveBeenCalledTimes(1);
    });

    it("handles multiple projects with different nightly times", async () => {
      mockListProjects.mockResolvedValue([
        { id: "proj-multi-1", name: "Project One" },
        { id: "proj-multi-2", name: "Project Two" },
      ]);
      mockGetSettings
        .mockResolvedValueOnce({
          deployment: {
            mode: "custom",
            targets: [{ name: "staging", autoDeployTrigger: "nightly" }],
            nightlyDeployTime: "02:00",
          },
        })
        .mockResolvedValueOnce({
          deployment: {
            mode: "custom",
            targets: [{ name: "production", autoDeployTrigger: "nightly" }],
            nightlyDeployTime: "04:00",
          },
        });
      mockTriggerDeploy.mockResolvedValue("deploy-x");

      const now = new Date(2025, 7, 20, 2, 0, 0); // Aug 20, 2025 02:00 - only proj-multi-1 matches
      const results = await runNightlyTick(now);

      expect(results).toHaveLength(1);
      expect(results[0].projectId).toBe("proj-multi-1");
      expect(mockTriggerDeploy).toHaveBeenCalledWith("proj-multi-1", "staging");
    });

    it("returns empty array when no projects", async () => {
      mockListProjects.mockResolvedValue([]);

      const now = new Date(2025, 1, 15, 2, 0, 0);
      const results = await runNightlyTick(now);

      expect(results).toHaveLength(0);
      expect(mockTriggerDeploy).not.toHaveBeenCalled();
    });
  });

  describe("startNightlyDeployScheduler / stopNightlyDeployScheduler", () => {
    it("starts and stops without error", () => {
      expect(() => startNightlyDeployScheduler()).not.toThrow();
      expect(() => stopNightlyDeployScheduler()).not.toThrow();
    });

    it("can stop after double start (idempotent)", () => {
      startNightlyDeployScheduler();
      startNightlyDeployScheduler();
      expect(() => stopNightlyDeployScheduler()).not.toThrow();
    });
  });
});
