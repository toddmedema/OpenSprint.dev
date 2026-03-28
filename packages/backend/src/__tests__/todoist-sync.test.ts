import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task } from "@doist/todoist-api-typescript";
import type {
  FeedbackItem,
  FeedbackSubmitRequest,
  IntegrationConnection,
  IntegrationImportLedgerEntry,
  ServerEvent,
} from "@opensprint/shared";
import type { IntegrationStoreService } from "../services/integration-store.service.js";
import type { TokenEncryptionService } from "../services/token-encryption.service.js";
import type { TodoistSyncDeps } from "../services/todoist-sync.service.js";

/* ── Todoist API client mock ─────────────────────────────────────────── */

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

/* ── taskStore mock (provenance UPDATE via runWrite) ─────────────────── */

const mockExecute = vi.fn().mockResolvedValue(1);
const mockQueryOne = vi.fn().mockResolvedValue({ extra: "{}" });
const mockRunWrite = vi.fn().mockImplementation(async (fn: (c: unknown) => Promise<unknown>) => {
  return fn({ queryOne: mockQueryOne, execute: mockExecute });
});

vi.mock("../services/task-store.service.js", () => ({
  taskStore: { runWrite: (...args: unknown[]) => mockRunWrite(...args) },
}));

/* ── Lazy-import after mocks are registered ──────────────────────────── */

const { TodoistSyncService } = await import("../services/todoist-sync.service.js");
const { TodoistAuthError, TodoistRateLimitError } = await import(
  "../services/todoist-api-client.service.js"
);

/* ── Helpers ─────────────────────────────────────────────────────────── */

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

function makeLedgerEntry(
  overrides: Partial<IntegrationImportLedgerEntry> = {},
): IntegrationImportLedgerEntry {
  return {
    id: "led-1",
    project_id: "proj-1",
    provider: "todoist",
    external_item_id: "task-1",
    feedback_id: "fb-1",
    import_status: "pending_delete",
    last_error: null,
    retry_count: 0,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
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

/* ── Tests ───────────────────────────────────────────────────────────── */

describe("TodoistSyncService", () => {
  let deps: TodoistSyncDeps;
  let service: InstanceType<typeof TodoistSyncService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteTask.mockResolvedValue(true);
    mockGetTasks.mockResolvedValue([]);
    mockExecute.mockResolvedValue(1);
    mockQueryOne.mockResolvedValue({ extra: "{}" });
    mockRunWrite.mockImplementation(async (fn: (c: unknown) => Promise<unknown>) => {
      return fn({ queryOne: mockQueryOne, execute: mockExecute });
    });
    deps = createMockDeps();
    service = new TodoistSyncService(deps);
  });

  it("happy path: 3 new tasks → 3 feedback items, 3 ledger entries, 3 deletes, all completed", async () => {
    const tasks = [
      makeTask({ id: "t1", content: "Task 1", addedAt: "2025-01-01T00:00:00Z" }),
      makeTask({ id: "t2", content: "Task 2", addedAt: "2025-01-02T00:00:00Z" }),
      makeTask({ id: "t3", content: "Task 3", addedAt: "2025-01-03T00:00:00Z" }),
    ];
    mockGetTasks.mockResolvedValue(tasks);

    let fbIdx = 0;
    (deps.submitFeedback as ReturnType<typeof vi.fn>).mockImplementation(
      async () => makeFeedbackItem(`fb-${++fbIdx}`),
    );

    const store = deps.integrationStore;
    (store.getPendingDeletes as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeLedgerEntry({ id: "led-1", external_item_id: "t1", feedback_id: "fb-1" })])
      .mockResolvedValueOnce([makeLedgerEntry({ id: "led-2", external_item_id: "t2", feedback_id: "fb-2" })])
      .mockResolvedValueOnce([makeLedgerEntry({ id: "led-3", external_item_id: "t3", feedback_id: "fb-3" })])
      .mockResolvedValueOnce([]); // retryPendingDeletes — nothing left

    const result = await service.runSync("conn-1");

    expect(result).toEqual({ imported: 3, errors: 0 });
    expect(deps.submitFeedback).toHaveBeenCalledTimes(3);
    expect(store.recordImport).toHaveBeenCalledTimes(3);
    expect(mockDeleteTask).toHaveBeenCalledTimes(3);
    expect(store.markCompleted).toHaveBeenCalledTimes(3);
    expect(store.markCompleted).toHaveBeenCalledWith("led-1");
    expect(store.markCompleted).toHaveBeenCalledWith("led-2");
    expect(store.markCompleted).toHaveBeenCalledWith("led-3");
  });

  it("duplicate skip: task already in ledger is not re-imported or re-deleted", async () => {
    mockGetTasks.mockResolvedValue([makeTask({ id: "dup-1" })]);
    (deps.integrationStore.hasBeenImported as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const result = await service.runSync("conn-1");

    expect(result.imported).toBe(0);
    expect(deps.submitFeedback).not.toHaveBeenCalled();
    expect(mockDeleteTask).not.toHaveBeenCalled();
    expect(deps.integrationStore.recordImport).not.toHaveBeenCalled();
  });

  it("delete failure: feedback created but deleteTask throws → markFailedDelete called", async () => {
    mockGetTasks.mockResolvedValue([makeTask({ id: "del-fail-1" })]);
    mockDeleteTask.mockRejectedValue(new Error("Network error"));

    const store = deps.integrationStore;
    const ledger = makeLedgerEntry({ id: "led-df", external_item_id: "del-fail-1" });
    (store.getPendingDeletes as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([ledger]) // deleteAndUpdateLedger
      .mockResolvedValueOnce([ledger]); // retryPendingDeletes — still pending

    const result = await service.runSync("conn-1");

    expect(result.imported).toBe(1);
    expect(deps.submitFeedback).toHaveBeenCalled();
    expect(store.recordImport).toHaveBeenCalled();
    expect(store.markFailedDelete).toHaveBeenCalledWith("led-df", "Network error");
    expect(store.markCompleted).not.toHaveBeenCalled();
  });

  it("pending delete retry: on success → markCompleted; on failure → markFailedDelete", async () => {
    mockGetTasks.mockResolvedValue([]);

    const entries = [
      makeLedgerEntry({
        id: "led-r1",
        external_item_id: "retry-1",
        retry_count: 1,
        import_status: "pending_delete",
      }),
      makeLedgerEntry({
        id: "led-r2",
        external_item_id: "retry-2",
        retry_count: 2,
        import_status: "failed_delete",
      }),
    ];
    (deps.integrationStore.getPendingDeletes as ReturnType<typeof vi.fn>).mockResolvedValue(entries);

    mockDeleteTask
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("Still failing"));

    await service.runSync("conn-1");

    expect(mockDeleteTask).toHaveBeenCalledWith("retry-1");
    expect(mockDeleteTask).toHaveBeenCalledWith("retry-2");
    expect(deps.integrationStore.markCompleted).toHaveBeenCalledWith("led-r1");
    expect(deps.integrationStore.markFailedDelete).toHaveBeenCalledWith("led-r2", "Still failing");
  });

  it("auth error (401): connection set to needs_reconnect, sync aborted", async () => {
    mockGetTasks.mockRejectedValue(new TodoistAuthError("Unauthorized", 401));

    const result = await service.runSync("conn-1");

    expect(deps.integrationStore.updateConnectionStatus).toHaveBeenCalledWith(
      "conn-1",
      "needs_reconnect",
      expect.stringContaining("Unauthorized"),
    );
    expect(result).toEqual({ imported: 0, errors: 0 });
    expect(deps.submitFeedback).not.toHaveBeenCalled();
  });

  it("rate limit (429): sync stops, last_error set", async () => {
    mockGetTasks.mockRejectedValue(new TodoistRateLimitError("Rate limited", 30));

    const result = await service.runSync("conn-1");

    expect(deps.integrationStore.updateLastSync).toHaveBeenCalledWith(
      "conn-1",
      expect.any(String),
      expect.stringContaining("Rate limited"),
    );
    expect(result).toEqual({ imported: 0, errors: 0 });
    expect(deps.submitFeedback).not.toHaveBeenCalled();
  });

  it("empty project: no tasks → no imports, no errors, last_sync_at updated", async () => {
    mockGetTasks.mockResolvedValue([]);

    const result = await service.runSync("conn-1");

    expect(result).toEqual({ imported: 0, errors: 0 });
    expect(deps.submitFeedback).not.toHaveBeenCalled();
    expect(deps.integrationStore.updateLastSync).toHaveBeenCalledWith(
      "conn-1",
      expect.any(String),
      null,
    );
  });

  it("task ordering: tasks processed in addedAt ascending order", async () => {
    const tasks = [
      makeTask({ id: "late", addedAt: "2025-01-03T00:00:00Z", content: "Late" }),
      makeTask({ id: "early", addedAt: "2025-01-01T00:00:00Z", content: "Early" }),
      makeTask({ id: "mid", addedAt: "2025-01-02T00:00:00Z", content: "Mid" }),
    ];
    mockGetTasks.mockResolvedValue(tasks);

    let idx = 0;
    (deps.submitFeedback as ReturnType<typeof vi.fn>).mockImplementation(
      async () => makeFeedbackItem(`fb-${++idx}`),
    );

    await service.runSync("conn-1");

    const calls = (deps.submitFeedback as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1].text).toBe("Early");
    expect(calls[1][1].text).toBe("Mid");
    expect(calls[2][1].text).toBe("Late");
  });

  it("cap at 50: >50 tasks → only first 50 processed", async () => {
    const tasks = Array.from({ length: 60 }, (_, i) =>
      makeTask({
        id: `task-${i}`,
        addedAt: `2025-01-01T00:${String(i).padStart(2, "0")}:00Z`,
      }),
    );
    mockGetTasks.mockResolvedValue(tasks);

    let fbCount = 0;
    (deps.submitFeedback as ReturnType<typeof vi.fn>).mockImplementation(
      async () => makeFeedbackItem(`fb-${++fbCount}`),
    );

    const result = await service.runSync("conn-1");

    expect(result.imported).toBe(50);
    expect(deps.submitFeedback).toHaveBeenCalledTimes(50);
  });

  it("404 on deleteTask: treated as success (task already gone), ledger marked completed", async () => {
    // The API client converts a Todoist 404 into a truthy return; at the
    // sync-service level this is indistinguishable from a normal delete.
    mockGetTasks.mockResolvedValue([makeTask({ id: "gone-1" })]);
    mockDeleteTask.mockResolvedValue(true);

    const store = deps.integrationStore;
    (store.getPendingDeletes as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeLedgerEntry({ id: "led-404", external_item_id: "gone-1" })])
      .mockResolvedValueOnce([]); // retryPendingDeletes

    const result = await service.runSync("conn-1");

    expect(result.imported).toBe(1);
    expect(store.markCompleted).toHaveBeenCalledWith("led-404");
    expect(store.markFailedDelete).not.toHaveBeenCalled();
  });

  it("priority mapping: Todoist 4 → 0, 3 → 1, 2 → 2, 1 → 3", async () => {
    const tasks = [
      makeTask({ id: "p4", priority: 4, content: "Critical", addedAt: "2025-01-01T00:00:00Z" }),
      makeTask({ id: "p3", priority: 3, content: "High", addedAt: "2025-01-01T00:01:00Z" }),
      makeTask({ id: "p2", priority: 2, content: "Medium", addedAt: "2025-01-01T00:02:00Z" }),
      makeTask({ id: "p1", priority: 1, content: "Low", addedAt: "2025-01-01T00:03:00Z" }),
    ];
    mockGetTasks.mockResolvedValue(tasks);

    let idx = 0;
    (deps.submitFeedback as ReturnType<typeof vi.fn>).mockImplementation(
      async () => makeFeedbackItem(`fb-${++idx}`),
    );

    await service.runSync("conn-1");

    const calls = (deps.submitFeedback as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1].priority).toBe(0); // Todoist 4 → Critical
    expect(calls[1][1].priority).toBe(1); // Todoist 3 → High
    expect(calls[2][1].priority).toBe(2); // Todoist 2 → Medium
    expect(calls[3][1].priority).toBe(3); // Todoist 1 → Low
  });

  it("provenance in extra: contains source, todoistTaskId, todoistProjectId, importedAt, labels", async () => {
    const task = makeTask({ id: "prov-1", labels: ["frontend", "urgent"] });
    mockGetTasks.mockResolvedValue([task]);

    (deps.integrationStore.getPendingDeletes as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeLedgerEntry({ id: "led-prov", external_item_id: "prov-1" })])
      .mockResolvedValueOnce([]);

    await service.runSync("conn-1");

    expect(mockRunWrite).toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalled();

    const updateCall = mockExecute.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("UPDATE feedback SET extra"),
    );
    expect(updateCall).toBeDefined();

    const extraJson = JSON.parse(updateCall![1][0] as string) as Record<string, unknown>;
    expect(extraJson).toMatchObject({
      source: "todoist",
      todoistTaskId: "prov-1",
      todoistProjectId: "todoist-proj-1",
      labels: ["frontend", "urgent"],
    });
    expect(typeof extraJson.importedAt).toBe("string");
  });
});
