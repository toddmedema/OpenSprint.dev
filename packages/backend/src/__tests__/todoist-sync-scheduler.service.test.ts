import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IntegrationConnection, TodoistSyncResult } from "@opensprint/shared";

const mockGetActiveConnections = vi
  .fn<(provider?: string) => Promise<IntegrationConnection[]>>()
  .mockResolvedValue([]);

vi.mock("../services/integration-store.service.js", () => ({
  integrationStore: {
    getActiveConnections: (...args: unknown[]) => mockGetActiveConnections(...(args as [string?])),
  },
}));

vi.mock("../services/token-encryption.service.js", () => ({
  tokenEncryption: {
    encryptToken: vi.fn().mockReturnValue("enc"),
    decryptToken: vi.fn().mockReturnValue("dec"),
  },
}));

vi.mock("../services/feedback.service.js", () => ({
  FeedbackService: vi.fn().mockImplementation(() => ({
    submitFeedback: vi.fn().mockResolvedValue({ id: "fb-1", text: "test" }),
  })),
}));

vi.mock("../services/todoist-sync.service.js", () => ({
  TodoistSyncService: vi.fn().mockImplementation(() => ({
    runSync: vi.fn().mockResolvedValue({ imported: 0, errors: 0 }),
  })),
}));

const {
  runTodoistSyncTick,
  startTodoistSyncScheduler,
  stopTodoistSyncScheduler,
  _isTickInProgress,
  _resetForTest,
} = await import("../services/todoist-sync-scheduler.service.js");

function makeConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return {
    id: "conn-1",
    project_id: "proj-1",
    provider: "todoist",
    provider_user_id: "u1",
    provider_user_email: "test@example.com",
    provider_resource_id: "todoist-proj-1",
    provider_resource_name: "My Project",
    scopes: "data:read_write,data:delete",
    status: "active",
    last_sync_at: null,
    last_error: null,
    config: null,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeMockSyncService(runSyncImpl?: (id: string) => Promise<TodoistSyncResult>) {
  const runSync = vi
    .fn<(id: string) => Promise<TodoistSyncResult>>()
    .mockImplementation(runSyncImpl ?? (() => Promise.resolve({ imported: 0, errors: 0 })));
  return { runSync } as unknown as import("../services/todoist-sync.service.js").TodoistSyncService;
}

describe("TodoistSyncScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTest();
    mockGetActiveConnections.mockResolvedValue([]);
  });

  afterEach(() => {
    _resetForTest();
  });

  describe("runTodoistSyncTick", () => {
    it("returns empty when no active connections", async () => {
      mockGetActiveConnections.mockResolvedValue([]);

      const results = await runTodoistSyncTick(makeMockSyncService());

      expect(results).toEqual([]);
      expect(mockGetActiveConnections).toHaveBeenCalledWith("todoist");
    });

    it("calls runSync for each active connection", async () => {
      const conn1 = makeConnection({ id: "conn-1" });
      const conn2 = makeConnection({ id: "conn-2", project_id: "proj-2" });
      mockGetActiveConnections.mockResolvedValue([conn1, conn2]);

      const service = makeMockSyncService();
      (service.runSync as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ imported: 3, errors: 0 })
        .mockResolvedValueOnce({ imported: 1, errors: 1 });

      const results = await runTodoistSyncTick(service);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ connectionId: "conn-1", imported: 3, errors: 0 });
      expect(results[1]).toEqual({ connectionId: "conn-2", imported: 1, errors: 1 });
      expect(service.runSync).toHaveBeenCalledTimes(2);
      expect(service.runSync).toHaveBeenCalledWith("conn-1");
      expect(service.runSync).toHaveBeenCalledWith("conn-2");
    });

    it("catches per-connection errors without blocking others", async () => {
      const conn1 = makeConnection({ id: "conn-1" });
      const conn2 = makeConnection({ id: "conn-2" });
      mockGetActiveConnections.mockResolvedValue([conn1, conn2]);

      const service = makeMockSyncService();
      (service.runSync as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error("Network failure"))
        .mockResolvedValueOnce({ imported: 2, errors: 0 });

      const results = await runTodoistSyncTick(service);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ connectionId: "conn-1", imported: 0, errors: 1 });
      expect(results[1]).toEqual({ connectionId: "conn-2", imported: 2, errors: 0 });
    });

    it("skips tick when previous tick is still running (concurrency guard)", async () => {
      let resolveFirst: (() => void) | null = null;
      const slowPromise = new Promise<TodoistSyncResult>((resolve) => {
        resolveFirst = () => resolve({ imported: 1, errors: 0 });
      });

      mockGetActiveConnections.mockResolvedValue([makeConnection()]);

      const service = makeMockSyncService();
      (service.runSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(slowPromise);

      const firstTick = runTodoistSyncTick(service);

      // Allow the first tick to reach the await inside runSync
      await new Promise((r) => setTimeout(r, 0));
      expect(_isTickInProgress()).toBe(true);

      const secondTick = await runTodoistSyncTick(service);
      expect(secondTick).toEqual([]);

      resolveFirst!();
      const firstResult = await firstTick;
      expect(firstResult).toHaveLength(1);
      expect(_isTickInProgress()).toBe(false);
    });

    it("resets tickInProgress even when getActiveConnections throws", async () => {
      mockGetActiveConnections.mockRejectedValue(new Error("DB offline"));

      const results = await runTodoistSyncTick(makeMockSyncService());

      expect(results).toEqual([]);
      expect(_isTickInProgress()).toBe(false);
    });
  });

  describe("startTodoistSyncScheduler / stopTodoistSyncScheduler", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("starts and periodically triggers ticks", async () => {
      mockGetActiveConnections.mockResolvedValue([]);

      startTodoistSyncScheduler();

      await vi.advanceTimersByTimeAsync(90_000);
      expect(mockGetActiveConnections).toHaveBeenCalled();

      stopTodoistSyncScheduler();
    });

    it("does not start twice", () => {
      startTodoistSyncScheduler();
      startTodoistSyncScheduler();

      stopTodoistSyncScheduler();
    });

    it("stop clears the interval so no more ticks fire", async () => {
      startTodoistSyncScheduler();
      stopTodoistSyncScheduler();

      mockGetActiveConnections.mockClear();
      await vi.advanceTimersByTimeAsync(200_000);
      expect(mockGetActiveConnections).not.toHaveBeenCalled();
    });

    it("stop is idempotent", () => {
      stopTodoistSyncScheduler();
      stopTodoistSyncScheduler();
    });
  });
});
