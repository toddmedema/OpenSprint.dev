import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { WatchdogService } from "../services/watchdog.service.js";

vi.mock("../services/heartbeat.service.js", () => ({
  heartbeatService: {
    findStaleHeartbeats: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../services/orphan-recovery.service.js", () => ({
  orphanRecoveryService: {
    recoverOrphanedTasks: vi.fn().mockResolvedValue({ recovered: [] }),
  },
}));

vi.mock("../services/event-log.service.js", () => ({
  eventLogService: {
    append: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../services/branch-manager.js", () => ({
  BranchManager: vi.fn().mockImplementation(() => ({
    getWorktreeBasePath: vi.fn().mockReturnValue("/tmp/opensprint-worktrees"),
  })),
}));

import { heartbeatService } from "../services/heartbeat.service.js";
import { orphanRecoveryService } from "../services/orphan-recovery.service.js";
import { eventLogService } from "../services/event-log.service.js";

describe("WatchdogService", () => {
  let tmpDir: string;
  let watchdog: WatchdogService;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `watchdog-test-${Date.now()}`);
    await fs.mkdir(path.join(tmpDir, ".git"), { recursive: true });
    watchdog = new WatchdogService();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    watchdog.stop();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("should start and stop without errors", () => {
    watchdog.start([{ projectId: "proj-1", repoPath: tmpDir }]);
    watchdog.stop();
  });

  it("should not start twice", () => {
    watchdog.start([{ projectId: "proj-1", repoPath: tmpDir }]);
    watchdog.start([{ projectId: "proj-1", repoPath: tmpDir }]);
    watchdog.stop();
  });

  it("should detect stale heartbeats and log event", async () => {
    const staleData = [
      {
        taskId: "task-stale",
        heartbeat: {
          pid: 12345,
          lastOutputTimestamp: Date.now() - 300_000,
          heartbeatTimestamp: Date.now() - 300_000,
        },
      },
    ];
    vi.mocked(heartbeatService.findStaleHeartbeats).mockResolvedValue(staleData);

    watchdog.start([{ projectId: "proj-1", repoPath: tmpDir }]);

    // Manually trigger the check cycle (private, but we can invoke via a timer fire)
    // Access the internal runChecks method
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing private method for testing
    await (watchdog as any).runChecks();

    expect(heartbeatService.findStaleHeartbeats).toHaveBeenCalled();
    expect(eventLogService.append).toHaveBeenCalledWith(
      tmpDir,
      expect.objectContaining({
        taskId: "task-stale",
        event: "watchdog.stale_heartbeat",
      })
    );
  });

  it("should recover orphaned tasks and log event", async () => {
    vi.mocked(orphanRecoveryService.recoverOrphanedTasks).mockResolvedValue({
      recovered: ["task-orphan-1", "task-orphan-2"],
    });

    watchdog.start([{ projectId: "proj-1", repoPath: tmpDir }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing private method for testing
    await (watchdog as any).runChecks();

    expect(orphanRecoveryService.recoverOrphanedTasks).toHaveBeenCalledWith(tmpDir);
    expect(eventLogService.append).toHaveBeenCalledWith(
      tmpDir,
      expect.objectContaining({
        event: "watchdog.orphan_recovery",
        data: expect.objectContaining({ recovered: ["task-orphan-1", "task-orphan-2"] }),
      })
    );
  });

  it("should not log orphan event when none recovered", async () => {
    vi.mocked(orphanRecoveryService.recoverOrphanedTasks).mockResolvedValue({ recovered: [] });

    watchdog.start([{ projectId: "proj-1", repoPath: tmpDir }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing private method for testing
    await (watchdog as any).runChecks();

    const calls = vi.mocked(eventLogService.append).mock.calls;
    const orphanCalls = calls.filter(
      (c) => (c[1] as Record<string, unknown>).event === "watchdog.orphan_recovery"
    );
    expect(orphanCalls).toHaveLength(0);
  });

  it("should detect and remove stale git lock files", async () => {
    const lockPath = path.join(tmpDir, ".git", "index.lock");
    await fs.writeFile(lockPath, "lock");

    // Backdate the mtime to make it appear stale (>10 min)
    const staleTime = new Date(Date.now() - 15 * 60 * 1000);
    await fs.utimes(lockPath, staleTime, staleTime);

    watchdog.start([{ projectId: "proj-1", repoPath: tmpDir }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing private method for testing
    await (watchdog as any).runChecks();

    // Lock should be removed
    let exists = true;
    try {
      await fs.access(lockPath);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);

    expect(eventLogService.append).toHaveBeenCalledWith(
      tmpDir,
      expect.objectContaining({ event: "watchdog.stale_lock_removed" })
    );
  });

  it("should not remove fresh git lock files", async () => {
    const lockPath = path.join(tmpDir, ".git", "index.lock");
    await fs.writeFile(lockPath, "lock");

    watchdog.start([{ projectId: "proj-1", repoPath: tmpDir }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing private method for testing
    await (watchdog as any).runChecks();

    const exists = await fs
      .access(lockPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });
});
