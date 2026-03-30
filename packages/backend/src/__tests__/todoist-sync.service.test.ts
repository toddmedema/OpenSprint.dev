import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task } from "@doist/todoist-api-typescript";
import type {
  FeedbackItem,
  FeedbackSubmitRequest,
  IntegrationConnection,
  ServerEvent,
} from "@opensprint/shared";
import type { IntegrationStoreService } from "../services/integration-store.service.js";
import type { TokenEncryptionService } from "../services/token-encryption.service.js";
import type { TodoistSyncDeps } from "../services/todoist-sync.service.js";

const mockDeleteTask = vi.fn<(id: string) => Promise<boolean>>().mockResolvedValue(true);
const mockGetTasks = vi.fn<(projectId: string) => Promise<Task[]>>().mockResolvedValue([]);

vi.mock("../services/todoist-api-client.service.js", async () => {
  const actual = await vi.importActual<typeof import("../services/todoist-api-client.service.js")>(
    "../services/todoist-api-client.service.js"
  );
  return {
    ...actual,
    TodoistApiClient: vi.fn().mockImplementation(() => ({
      getTasks: mockGetTasks,
      deleteTask: mockDeleteTask,
    })),
  };
});

const mockRunWrite = vi.fn().mockImplementation(async (fn: (c: unknown) => Promise<unknown>) => {
  return fn({
    queryOne: vi.fn().mockResolvedValue({ extra: "{}" }),
    execute: vi.fn().mockResolvedValue(1),
  });
});

vi.mock("../services/task-store.service.js", () => ({
  taskStore: {
    runWrite: (...args: unknown[]) => mockRunWrite(...args),
  },
}));

const { TodoistSyncService } = await import("../services/todoist-sync.service.js");
const { TodoistAuthError, TodoistRateLimitError } =
  await import("../services/todoist-api-client.service.js");

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    userId: "u1",
    projectId: "todoist-proj-1",
    sectionId: null,
    parentId: null,
    addedByUid: "u1",
    assignedByUid: null,
    responsibleUid: null,
    labels: ["bug"],
    deadline: null,
    duration: null,
    checked: false,
    isDeleted: false,
    addedAt: "2025-01-01T00:00:00Z",
    completedAt: null,
    updatedAt: "2025-01-01T00:00:00Z",
    due: null,
    priority: 1,
    childOrder: 0,
    content: "Fix the login page",
    description: "",
    dayOrder: 0,
    isCollapsed: false,
    isUncompletable: false,
    url: "https://todoist.com/app/task/task-1",
    ...overrides,
  } as Task;
}

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

function makeFeedbackItem(id = "fb-1"): FeedbackItem {
  return {
    id,
    text: "Fix the login page",
    category: "bug",
    mappedPlanId: null,
    createdTaskIds: [],
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

function createMockDeps(overrides: Partial<TodoistSyncDeps> = {}): TodoistSyncDeps {
  const integrationStore: IntegrationStoreService = {
    getConnectionById: vi.fn().mockResolvedValue(makeConnection()),
    getEncryptedTokenById: vi.fn().mockResolvedValue("encrypted-token"),
    getConnection: vi.fn().mockResolvedValue(null),
    getActiveConnections: vi.fn().mockResolvedValue([]),
    upsertConnection: vi.fn().mockResolvedValue(makeConnection()),
    updateConnectionStatus: vi.fn().mockResolvedValue(undefined),
    updateLastSync: vi.fn().mockResolvedValue(undefined),
    deleteConnection: vi.fn().mockResolvedValue(undefined),
    recordImport: vi.fn().mockResolvedValue(true),
    claimImportSlot: vi.fn().mockResolvedValue(true),
    finalizeImportSlot: vi.fn().mockResolvedValue(undefined),
    abandonImportSlot: vi.fn().mockResolvedValue(undefined),
    getPendingDeletes: vi.fn().mockResolvedValue([]),
    markCompleted: vi.fn().mockResolvedValue(undefined),
    markFailedDelete: vi.fn().mockResolvedValue(undefined),
    hasBeenImported: vi.fn().mockResolvedValue(false),
  } as unknown as IntegrationStoreService;

  const submitFeedback = vi
    .fn<(projectId: string, body: FeedbackSubmitRequest) => Promise<FeedbackItem>>()
    .mockResolvedValue(makeFeedbackItem());

  const tokenEncryption: TokenEncryptionService = {
    encryptToken: vi.fn().mockReturnValue("encrypted"),
    decryptToken: vi.fn().mockReturnValue("decrypted-access-token"),
  } as unknown as TokenEncryptionService;

  const broadcastToProject = vi.fn<(projectId: string, event: ServerEvent) => void>();

  return { integrationStore, submitFeedback, tokenEncryption, broadcastToProject, ...overrides };
}

describe("TodoistSyncService", () => {
  let deps: TodoistSyncDeps;
  let service: InstanceType<typeof TodoistSyncService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteTask.mockResolvedValue(true);
    mockGetTasks.mockResolvedValue([]);
    mockRunWrite.mockImplementation(async (fn: (c: unknown) => Promise<unknown>) => {
      return fn({
        queryOne: vi.fn().mockResolvedValue({ extra: "{}" }),
        execute: vi.fn().mockResolvedValue(1),
      });
    });
    deps = createMockDeps();
    service = new TodoistSyncService(deps);
  });

  describe("runSync — precondition checks", () => {
    it("returns zero counts when connection not found", async () => {
      (deps.integrationStore.getConnectionById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await service.runSync("conn-missing");
      expect(result).toEqual({ imported: 0, errors: 0 });
      expect(mockGetTasks).not.toHaveBeenCalled();
    });

    it("returns zero counts when connection status is not active", async () => {
      (deps.integrationStore.getConnectionById as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeConnection({ status: "needs_reconnect" })
      );

      const result = await service.runSync("conn-1");
      expect(result).toEqual({ imported: 0, errors: 0 });
      expect(mockGetTasks).not.toHaveBeenCalled();
    });

    it("returns zero counts when no provider_resource_id selected", async () => {
      (deps.integrationStore.getConnectionById as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeConnection({ provider_resource_id: null })
      );

      const result = await service.runSync("conn-1");
      expect(result).toEqual({ imported: 0, errors: 0 });
      expect(mockGetTasks).not.toHaveBeenCalled();
    });

    it("returns zero counts when encrypted token is missing", async () => {
      (deps.integrationStore.getEncryptedTokenById as ReturnType<typeof vi.fn>).mockResolvedValue(
        null
      );

      const result = await service.runSync("conn-1");
      expect(result).toEqual({ imported: 0, errors: 0 });
      expect(deps.integrationStore.updateLastSync).toHaveBeenCalledWith(
        "conn-1",
        expect.any(String),
        "No access token stored"
      );
    });

    it("returns zero counts when token decryption fails", async () => {
      (deps.tokenEncryption.decryptToken as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Decryption failed");
      });

      const result = await service.runSync("conn-1");
      expect(result).toEqual({ imported: 0, errors: 0 });
      expect(deps.integrationStore.updateLastSync).toHaveBeenCalledWith(
        "conn-1",
        expect.any(String),
        "Token decryption failed"
      );
    });
  });

  describe("runSync — task import", () => {
    it("imports a single task end-to-end", async () => {
      const task = makeTask();
      mockGetTasks.mockResolvedValue([task]);
      const ledgerEntry = {
        id: "led-1",
        project_id: "proj-1",
        provider: "todoist" as const,
        external_item_id: "task-1",
        feedback_id: "fb-1",
        import_status: "pending_delete" as const,
        last_error: null,
        retry_count: 0,
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z",
      };
      (deps.integrationStore.getPendingDeletes as ReturnType<typeof vi.fn>).mockResolvedValue([
        ledgerEntry,
      ]);

      const result = await service.runSync("conn-1");

      expect(result.imported).toBe(1);
      expect(result.errors).toBe(0);

      expect(deps.integrationStore.claimImportSlot).toHaveBeenCalledWith(
        "proj-1",
        "todoist",
        "task-1"
      );
      expect(deps.submitFeedback).toHaveBeenCalledWith("proj-1", {
        text: "Fix the login page",
        priority: 3,
      });
      expect(deps.integrationStore.finalizeImportSlot).toHaveBeenCalledWith(
        "proj-1",
        "todoist",
        "task-1",
        "fb-1"
      );
      expect(mockDeleteTask).toHaveBeenCalledWith("task-1");
      expect(deps.integrationStore.markCompleted).toHaveBeenCalledWith("led-1");
    });

    it("appends description to feedback text", async () => {
      const task = makeTask({
        content: "Add search",
        description: "Full-text search using Postgres",
      });
      mockGetTasks.mockResolvedValue([task]);
      (deps.integrationStore.getPendingDeletes as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "led-1",
          external_item_id: "task-1",
          import_status: "pending_delete",
        },
      ]);

      await service.runSync("conn-1");

      expect(deps.submitFeedback).toHaveBeenCalledWith("proj-1", {
        text: "Add search\nFull-text search using Postgres",
        priority: 3,
      });
    });

    it("maps Todoist priorities correctly", async () => {
      const tasks = [
        makeTask({ id: "t1", priority: 4, content: "Critical" }),
        makeTask({ id: "t2", priority: 3, content: "High" }),
        makeTask({ id: "t3", priority: 2, content: "Medium" }),
        makeTask({ id: "t4", priority: 1, content: "Low" }),
      ];
      mockGetTasks.mockResolvedValue(tasks);

      let callIdx = 0;
      (deps.submitFeedback as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        return makeFeedbackItem(`fb-${++callIdx}`);
      });
      (deps.integrationStore.getPendingDeletes as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await service.runSync("conn-1");

      const calls = (deps.submitFeedback as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][1].priority).toBe(0); // Critical
      expect(calls[1][1].priority).toBe(1); // High
      expect(calls[2][1].priority).toBe(2); // Medium
      expect(calls[3][1].priority).toBe(3); // Low
    });

    it("skips task when import slot is already claimed", async () => {
      const task = makeTask();
      mockGetTasks.mockResolvedValue([task]);
      (deps.integrationStore.claimImportSlot as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const result = await service.runSync("conn-1");

      expect(result.imported).toBe(0);
      expect(deps.submitFeedback).not.toHaveBeenCalled();
    });

    it("releases claimed slot when feedback creation fails", async () => {
      const task = makeTask();
      mockGetTasks.mockResolvedValue([task]);
      (deps.submitFeedback as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DB error"));

      const result = await service.runSync("conn-1");

      expect(result.imported).toBe(0);
      expect(result.errors).toBe(1);
      expect(deps.integrationStore.abandonImportSlot).toHaveBeenCalledWith(
        "proj-1",
        "todoist",
        "task-1"
      );
    });

    it("caps processing at 50 tasks", async () => {
      const tasks = Array.from({ length: 60 }, (_, i) =>
        makeTask({ id: `task-${i}`, addedAt: `2025-01-01T00:${String(i).padStart(2, "0")}:00Z` })
      );
      mockGetTasks.mockResolvedValue(tasks);

      let feedbackCount = 0;
      (deps.submitFeedback as ReturnType<typeof vi.fn>).mockImplementation(async () =>
        makeFeedbackItem(`fb-${++feedbackCount}`)
      );
      (deps.integrationStore.getPendingDeletes as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await service.runSync("conn-1");

      expect(result.imported).toBe(50);
      expect((deps.submitFeedback as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(50);
    });

    it("sorts tasks by addedAt ascending", async () => {
      const tasks = [
        makeTask({ id: "late", addedAt: "2025-01-03T00:00:00Z", content: "Late" }),
        makeTask({ id: "early", addedAt: "2025-01-01T00:00:00Z", content: "Early" }),
        makeTask({ id: "mid", addedAt: "2025-01-02T00:00:00Z", content: "Mid" }),
      ];
      mockGetTasks.mockResolvedValue(tasks);

      let callIdx = 0;
      (deps.submitFeedback as ReturnType<typeof vi.fn>).mockImplementation(async () =>
        makeFeedbackItem(`fb-${++callIdx}`)
      );
      (deps.integrationStore.getPendingDeletes as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await service.runSync("conn-1");

      const calls = (deps.submitFeedback as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][1].text).toBe("Early");
      expect(calls[1][1].text).toBe("Mid");
      expect(calls[2][1].text).toBe("Late");
    });

    it("counts errors when individual task processing fails", async () => {
      const tasks = [makeTask({ id: "t1" }), makeTask({ id: "t2" })];
      mockGetTasks.mockResolvedValue(tasks);

      let callCount = 0;
      (deps.submitFeedback as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error("DB error");
        return makeFeedbackItem("fb-2");
      });
      (deps.integrationStore.getPendingDeletes as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await service.runSync("conn-1");

      expect(result.errors).toBe(1);
      expect(result.imported).toBe(1);
    });

    it("imports only once when two sync runs race on same task", async () => {
      const task = makeTask();
      mockGetTasks.mockResolvedValue([task]);
      const claimImportSlot = deps.integrationStore.claimImportSlot as ReturnType<typeof vi.fn>;
      claimImportSlot.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const [first, second] = await Promise.all([
        service.runSync("conn-1"),
        service.runSync("conn-1"),
      ]);

      expect(first.imported + second.imported).toBe(1);
      expect(deps.submitFeedback).toHaveBeenCalledTimes(1);
      expect(deps.integrationStore.finalizeImportSlot).toHaveBeenCalledTimes(1);
    });
  });

  describe("runSync — delete handling", () => {
    it("marks ledger entry completed on successful delete", async () => {
      const task = makeTask();
      mockGetTasks.mockResolvedValue([task]);
      const ledgerEntry = {
        id: "led-1",
        project_id: "proj-1",
        provider: "todoist" as const,
        external_item_id: "task-1",
        feedback_id: "fb-1",
        import_status: "pending_delete" as const,
        last_error: null,
        retry_count: 0,
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z",
      };
      (deps.integrationStore.getPendingDeletes as ReturnType<typeof vi.fn>).mockResolvedValue([
        ledgerEntry,
      ]);

      await service.runSync("conn-1");

      expect(deps.integrationStore.markCompleted).toHaveBeenCalledWith("led-1");
    });

    it("marks ledger entry failed_delete when delete fails", async () => {
      const task = makeTask();
      mockGetTasks.mockResolvedValue([task]);
      mockDeleteTask.mockRejectedValue(new Error("Network error"));
      const ledgerEntry = {
        id: "led-1",
        project_id: "proj-1",
        provider: "todoist" as const,
        external_item_id: "task-1",
        feedback_id: "fb-1",
        import_status: "pending_delete" as const,
        last_error: null,
        retry_count: 0,
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z",
      };
      (deps.integrationStore.getPendingDeletes as ReturnType<typeof vi.fn>).mockResolvedValue([
        ledgerEntry,
      ]);

      const result = await service.runSync("conn-1");

      expect(deps.integrationStore.markFailedDelete).toHaveBeenCalledWith("led-1", "Network error");
      expect(result.imported).toBe(1);
    });
  });

  describe("runSync — retry pending deletes", () => {
    it("retries pending deletes after processing new tasks", async () => {
      mockGetTasks.mockResolvedValue([]);
      const pendingEntries = [
        {
          id: "led-old-1",
          project_id: "proj-1",
          provider: "todoist" as const,
          external_item_id: "old-task-1",
          feedback_id: "fb-old-1",
          import_status: "pending_delete" as const,
          last_error: null,
          retry_count: 1,
          created_at: "2025-01-01T00:00:00.000Z",
          updated_at: "2025-01-01T00:00:00.000Z",
        },
        {
          id: "led-old-2",
          project_id: "proj-1",
          provider: "todoist" as const,
          external_item_id: "old-task-2",
          feedback_id: "fb-old-2",
          import_status: "failed_delete" as const,
          last_error: "prev error",
          retry_count: 2,
          created_at: "2025-01-01T00:00:00.000Z",
          updated_at: "2025-01-01T00:00:00.000Z",
        },
      ];
      (deps.integrationStore.getPendingDeletes as ReturnType<typeof vi.fn>).mockResolvedValue(
        pendingEntries
      );

      await service.runSync("conn-1");

      expect(mockDeleteTask).toHaveBeenCalledWith("old-task-1");
      expect(mockDeleteTask).toHaveBeenCalledWith("old-task-2");
      expect(deps.integrationStore.markCompleted).toHaveBeenCalledWith("led-old-1");
      expect(deps.integrationStore.markCompleted).toHaveBeenCalledWith("led-old-2");
    });

    it("marks failed on retry delete error", async () => {
      mockGetTasks.mockResolvedValue([]);
      const pendingEntries = [
        {
          id: "led-retry",
          project_id: "proj-1",
          provider: "todoist" as const,
          external_item_id: "retry-task",
          feedback_id: "fb-retry",
          import_status: "pending_delete" as const,
          last_error: null,
          retry_count: 0,
          created_at: "2025-01-01T00:00:00.000Z",
          updated_at: "2025-01-01T00:00:00.000Z",
        },
      ];
      (deps.integrationStore.getPendingDeletes as ReturnType<typeof vi.fn>).mockResolvedValue(
        pendingEntries
      );
      mockDeleteTask.mockRejectedValue(new Error("Still failing"));

      await service.runSync("conn-1");

      expect(deps.integrationStore.markFailedDelete).toHaveBeenCalledWith(
        "led-retry",
        "Still failing"
      );
    });
  });

  describe("runSync — error handling", () => {
    it("sets needs_reconnect on TodoistAuthError", async () => {
      mockGetTasks.mockRejectedValue(new TodoistAuthError("Unauthorized", 401));

      const result = await service.runSync("conn-1");

      expect(deps.integrationStore.updateConnectionStatus).toHaveBeenCalledWith(
        "conn-1",
        "needs_reconnect",
        expect.stringContaining("Unauthorized")
      );
      expect(result).toEqual({ imported: 0, errors: 0 });
    });

    it("sets last_error on TodoistRateLimitError and stops", async () => {
      mockGetTasks.mockRejectedValue(new TodoistRateLimitError("Rate limited", 30));

      const result = await service.runSync("conn-1");

      expect(deps.integrationStore.updateLastSync).toHaveBeenCalledWith(
        "conn-1",
        expect.any(String),
        expect.stringContaining("Rate limited")
      );
      expect(result).toEqual({ imported: 0, errors: 0 });
    });

    it("propagates auth error from delete up to top-level handler", async () => {
      const task = makeTask();
      mockGetTasks.mockResolvedValue([task]);
      mockDeleteTask.mockRejectedValue(new TodoistAuthError("Token revoked", 401));
      const ledgerEntry = {
        id: "led-1",
        project_id: "proj-1",
        provider: "todoist" as const,
        external_item_id: "task-1",
        feedback_id: "fb-1",
        import_status: "pending_delete" as const,
        last_error: null,
        retry_count: 0,
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z",
      };
      (deps.integrationStore.getPendingDeletes as ReturnType<typeof vi.fn>).mockResolvedValue([
        ledgerEntry,
      ]);

      await service.runSync("conn-1");

      expect(deps.integrationStore.updateConnectionStatus).toHaveBeenCalledWith(
        "conn-1",
        "needs_reconnect",
        expect.stringContaining("Token revoked")
      );
    });

    it("handles unexpected errors gracefully", async () => {
      mockGetTasks.mockRejectedValue(new Error("Connection reset"));

      const result = await service.runSync("conn-1");

      expect(deps.integrationStore.updateLastSync).toHaveBeenCalledWith(
        "conn-1",
        expect.any(String),
        "Connection reset"
      );
      expect(result).toEqual({ imported: 0, errors: 0 });
    });
  });

  describe("runSync — sync metadata updates", () => {
    it("updates last_sync_at and clears error on success", async () => {
      mockGetTasks.mockResolvedValue([]);

      await service.runSync("conn-1");

      expect(deps.integrationStore.updateLastSync).toHaveBeenCalledWith(
        "conn-1",
        expect.any(String),
        null
      );
    });
  });

  describe("runSync — broadcast events", () => {
    it("broadcasts sync.started and sync.completed on successful sync", async () => {
      mockGetTasks.mockResolvedValue([]);

      await service.runSync("conn-1");

      const broadcast = deps.broadcastToProject as ReturnType<typeof vi.fn>;
      const calls = broadcast.mock.calls as [string, ServerEvent][];
      const types = calls.map(([, ev]) => ev.type);

      expect(types).toContain("integration.sync.started");
      expect(types).toContain("integration.sync.completed");

      const started = calls.find(([, ev]) => ev.type === "integration.sync.started");
      expect(started).toBeDefined();
      expect(started![0]).toBe("proj-1");
      expect(started![1]).toMatchObject({
        type: "integration.sync.started",
        provider: "todoist",
        projectId: "proj-1",
      });

      const completed = calls.find(([, ev]) => ev.type === "integration.sync.completed");
      expect(completed).toBeDefined();
      expect(completed![1]).toMatchObject({
        type: "integration.sync.completed",
        provider: "todoist",
        projectId: "proj-1",
        imported: 0,
        errors: 0,
      });
    });

    it("broadcasts sync.completed with import count", async () => {
      const task = makeTask();
      mockGetTasks.mockResolvedValue([task]);
      (deps.integrationStore.getPendingDeletes as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "led-1",
          external_item_id: "task-1",
          import_status: "pending_delete",
        },
      ]);

      await service.runSync("conn-1");

      const broadcast = deps.broadcastToProject as ReturnType<typeof vi.fn>;
      const calls = broadcast.mock.calls as [string, ServerEvent][];
      const completed = calls.find(([, ev]) => ev.type === "integration.sync.completed");
      expect(completed![1]).toMatchObject({
        imported: 1,
        errors: 0,
      });
    });

    it("broadcasts connection.updated and sync.error on auth error", async () => {
      mockGetTasks.mockRejectedValue(new TodoistAuthError("Unauthorized", 401));

      await service.runSync("conn-1");

      const broadcast = deps.broadcastToProject as ReturnType<typeof vi.fn>;
      const calls = broadcast.mock.calls as [string, ServerEvent][];
      const types = calls.map(([, ev]) => ev.type);

      expect(types).toContain("integration.connection.updated");
      expect(types).toContain("integration.sync.error");

      const connUpdate = calls.find(([, ev]) => ev.type === "integration.connection.updated");
      expect(connUpdate![1]).toMatchObject({
        provider: "todoist",
        projectId: "proj-1",
        status: "needs_reconnect",
      });

      const syncError = calls.find(([, ev]) => ev.type === "integration.sync.error");
      expect(syncError![1]).toMatchObject({
        provider: "todoist",
        projectId: "proj-1",
        error: expect.stringContaining("Unauthorized"),
        status: "needs_reconnect",
      });
    });

    it("broadcasts sync.error on rate limit", async () => {
      mockGetTasks.mockRejectedValue(new TodoistRateLimitError("Rate limited", 30));

      await service.runSync("conn-1");

      const broadcast = deps.broadcastToProject as ReturnType<typeof vi.fn>;
      const calls = broadcast.mock.calls as [string, ServerEvent][];
      const syncError = calls.find(([, ev]) => ev.type === "integration.sync.error");

      expect(syncError).toBeDefined();
      expect(syncError![1]).toMatchObject({
        type: "integration.sync.error",
        provider: "todoist",
        error: expect.stringContaining("Rate limited"),
      });
    });

    it("broadcasts sync.error on unexpected error", async () => {
      mockGetTasks.mockRejectedValue(new Error("Connection reset"));

      await service.runSync("conn-1");

      const broadcast = deps.broadcastToProject as ReturnType<typeof vi.fn>;
      const calls = broadcast.mock.calls as [string, ServerEvent][];
      const syncError = calls.find(([, ev]) => ev.type === "integration.sync.error");

      expect(syncError).toBeDefined();
      expect(syncError![1]).toMatchObject({
        type: "integration.sync.error",
        provider: "todoist",
        error: "Connection reset",
      });
    });

    it("does not fail when broadcastToProject is undefined", async () => {
      const noBroadcastDeps = createMockDeps({ broadcastToProject: undefined });
      const noBroadcastService = new TodoistSyncService(noBroadcastDeps);
      mockGetTasks.mockResolvedValue([]);

      const result = await noBroadcastService.runSync("conn-1");
      expect(result).toEqual({ imported: 0, errors: 0 });
    });
  });
});
