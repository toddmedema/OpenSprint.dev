import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DbClient } from "../db/client.js";
import { createMockDbClient } from "./test-db-helper.js";

const queryFn = vi
  .fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>()
  .mockResolvedValue([]);
const queryOneFn = vi
  .fn<(sql: string, params?: unknown[]) => Promise<unknown | undefined>>()
  .mockResolvedValue(undefined);
const executeFn = vi
  .fn<(sql: string, params?: unknown[]) => Promise<number>>()
  .mockResolvedValue(1);

const mockDb: DbClient = createMockDbClient({
  query: queryFn,
  queryOne: queryOneFn,
  execute: executeFn,
});

vi.mock("../services/task-store.service.js", () => {
  return {
    taskStore: {
      getDb: vi.fn().mockImplementation(async () => mockDb),
      runWrite: vi
        .fn()
        .mockImplementation(async (fn: (c: DbClient) => Promise<unknown>) => fn(mockDb)),
    },
  };
});

const { IntegrationStoreService } = await import("../services/integration-store.service.js");

let store: InstanceType<typeof IntegrationStoreService>;

beforeEach(() => {
  queryFn.mockReset().mockResolvedValue([]);
  queryOneFn.mockReset().mockResolvedValue(undefined);
  executeFn.mockReset().mockResolvedValue(1);
  store = new IntegrationStoreService();
});

function makeConnectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    project_id: "proj-1",
    provider: "todoist",
    provider_user_id: "u1",
    provider_user_email: "test@example.com",
    provider_resource_id: "res-1",
    provider_resource_name: "My Project",
    access_token_enc: "enc-token",
    refresh_token_enc: null,
    token_expires_at: null,
    scopes: "data:read_write,data:delete",
    status: "active",
    last_sync_at: null,
    last_error: null,
    config: '{"pollIntervalSeconds":60}',
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeLedgerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    project_id: "proj-1",
    provider: "todoist",
    external_item_id: "ext-1",
    feedback_id: "fb-1",
    import_status: "pending_delete",
    last_error: null,
    retry_count: 0,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ─── integration_connections ───

describe("IntegrationStoreService — connections", () => {
  describe("getConnection", () => {
    it("returns null when no connection exists", async () => {
      const result = await store.getConnection("proj-1", "todoist");
      expect(result).toBeNull();
      expect(queryOneFn).toHaveBeenCalledWith(
        expect.stringContaining("FROM integration_connections"),
        ["proj-1", "todoist"]
      );
    });

    it("returns mapped IntegrationConnection when row exists", async () => {
      queryOneFn.mockResolvedValueOnce(makeConnectionRow());
      const result = await store.getConnection("proj-1", "todoist");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("conn-1");
      expect(result!.provider).toBe("todoist");
      expect(result!.status).toBe("active");
      expect(result!.config).toEqual({ pollIntervalSeconds: 60 });
    });

    it("parses null config as null", async () => {
      queryOneFn.mockResolvedValueOnce(makeConnectionRow({ config: null }));
      const result = await store.getConnection("proj-1", "todoist");
      expect(result!.config).toBeNull();
    });
  });

  describe("getActiveConnections", () => {
    it("returns all active connections when no provider filter", async () => {
      queryFn.mockResolvedValueOnce([makeConnectionRow(), makeConnectionRow({ id: "conn-2" })]);
      const result = await store.getActiveConnections();
      expect(result).toHaveLength(2);
      expect(queryFn).toHaveBeenCalledWith(expect.stringContaining("status = $1"), ["active"]);
    });

    it("filters by provider when provided", async () => {
      queryFn.mockResolvedValueOnce([makeConnectionRow()]);
      const result = await store.getActiveConnections("todoist");
      expect(result).toHaveLength(1);
      expect(queryFn).toHaveBeenCalledWith(expect.stringContaining("provider = $2"), [
        "active",
        "todoist",
      ]);
    });

    it("returns empty array when no active connections", async () => {
      queryFn.mockResolvedValueOnce([]);
      const result = await store.getActiveConnections();
      expect(result).toEqual([]);
    });
  });

  describe("upsertConnection", () => {
    it("inserts new connection when none exists", async () => {
      const row = makeConnectionRow();
      queryOneFn
        .mockResolvedValueOnce(undefined) // check existing
        .mockResolvedValueOnce(row); // fetch saved

      const result = await store.upsertConnection({
        project_id: "proj-1",
        provider: "todoist",
        access_token_enc: "enc-token",
        scopes: "data:read_write,data:delete",
      });

      expect(result.provider).toBe("todoist");
      expect(result.status).toBe("active");
      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO integration_connections"),
        expect.any(Array)
      );
    });

    it("updates existing connection when one exists", async () => {
      const row = makeConnectionRow();
      queryOneFn
        .mockResolvedValueOnce({
          id: "conn-1",
          config: '{"pollIntervalSeconds":60}',
        }) // check existing
        .mockResolvedValueOnce(row); // fetch saved

      const result = await store.upsertConnection({
        project_id: "proj-1",
        provider: "todoist",
        access_token_enc: "new-enc-token",
      });

      expect(result.id).toBe("conn-1");
      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE integration_connections"),
        expect.any(Array)
      );
    });

    it("throws when result row is not found after upsert", async () => {
      queryOneFn.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);

      await expect(
        store.upsertConnection({
          project_id: "proj-1",
          provider: "todoist",
          access_token_enc: "token",
        })
      ).rejects.toThrow("Failed to upsert");
    });

    it("sets todoistImportCutoffIso on insert for new todoist connections", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-06-01T12:00:00.000Z"));
      const row = makeConnectionRow({
        config: JSON.stringify({ todoistImportCutoffIso: "2025-06-01T12:00:00.000Z" }),
      });
      queryOneFn.mockResolvedValueOnce(undefined).mockResolvedValueOnce(row);

      await store.upsertConnection({
        project_id: "proj-1",
        provider: "todoist",
        access_token_enc: "enc-token",
      });

      vi.useRealTimers();
      const insertCall = executeFn.mock.calls.find((c) =>
        (c[0] as string).includes("INSERT INTO integration_connections")
      );
      expect(insertCall).toBeDefined();
      const args = insertCall![1] as unknown[];
      expect(JSON.parse(args[12] as string)).toEqual({
        todoistImportCutoffIso: "2025-06-01T12:00:00.000Z",
      });
    });
  });

  describe("updateConnectionStatus", () => {
    it("updates status and error", async () => {
      await store.updateConnectionStatus("conn-1", "needs_reconnect", "Token invalid");
      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE integration_connections SET status"),
        ["needs_reconnect", "Token invalid", expect.any(String), "conn-1"]
      );
    });

    it("clears error when not provided", async () => {
      await store.updateConnectionStatus("conn-1", "active");
      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE integration_connections SET status"),
        ["active", null, expect.any(String), "conn-1"]
      );
    });
  });

  describe("updateLastSync", () => {
    it("updates last_sync_at and clears error", async () => {
      const syncAt = "2025-06-01T12:00:00.000Z";
      await store.updateLastSync("conn-1", syncAt);
      expect(executeFn).toHaveBeenCalledWith(expect.stringContaining("last_sync_at"), [
        syncAt,
        null,
        expect.any(String),
        "conn-1",
      ]);
    });

    it("sets error when provided", async () => {
      const syncAt = "2025-06-01T12:00:00.000Z";
      await store.updateLastSync("conn-1", syncAt, "Rate limited");
      expect(executeFn).toHaveBeenCalledWith(expect.stringContaining("last_sync_at"), [
        syncAt,
        "Rate limited",
        expect.any(String),
        "conn-1",
      ]);
    });
  });

  describe("deleteConnection", () => {
    it("deletes the connection row", async () => {
      await store.deleteConnection("proj-1", "todoist");
      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM integration_connections"),
        ["proj-1", "todoist"]
      );
    });
  });
});

// ─── integration_import_ledger ───

describe("IntegrationStoreService — ledger", () => {
  describe("claimImportSlot", () => {
    it("claims slot when insert succeeds", async () => {
      queryOneFn.mockResolvedValueOnce(undefined); // no stale importing row
      executeFn.mockResolvedValueOnce(1); // insert
      const result = await store.claimImportSlot("proj-1", "todoist", "ext-1");
      expect(result).toBe(true);
      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("ON CONFLICT (project_id, provider, external_item_id) DO NOTHING"),
        expect.arrayContaining(["proj-1", "todoist", "ext-1", "__pending__", "importing"])
      );
    });

    it("returns false when slot already exists", async () => {
      queryOneFn.mockResolvedValueOnce(undefined);
      executeFn.mockResolvedValueOnce(0); // insert no-op due to conflict
      const result = await store.claimImportSlot("proj-1", "todoist", "ext-1");
      expect(result).toBe(false);
    });

    it("deletes stale importing row when feedback was never attached", async () => {
      queryOneFn.mockResolvedValueOnce({ id: 42, feedback_id: "__pending__" });
      executeFn.mockResolvedValueOnce(1).mockResolvedValueOnce(1); // DELETE stale, insert
      await store.claimImportSlot("proj-1", "todoist", "ext-1");
      expect(executeFn).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("DELETE FROM integration_import_ledger WHERE id = $1"),
        [42]
      );
    });

    it("promotes stale importing row when feedback id was already linked", async () => {
      queryOneFn.mockResolvedValueOnce({ id: 7, feedback_id: "fb-orphan" });
      executeFn.mockResolvedValueOnce(1).mockResolvedValueOnce(1); // UPDATE stale, insert
      await store.claimImportSlot("proj-1", "todoist", "ext-1");
      expect(executeFn).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("SET import_status = $1"),
        ["pending_delete", null, expect.any(String), 7]
      );
    });
  });

  describe("attachFeedbackToImportSlot", () => {
    it("sets feedback_id on importing row with placeholder id", async () => {
      executeFn.mockResolvedValueOnce(1);
      await store.attachFeedbackToImportSlot("proj-1", "todoist", "ext-1", "fb-1");
      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("SET feedback_id = $1, updated_at = $2"),
        expect.arrayContaining([
          "fb-1",
          expect.any(String),
          "proj-1",
          "todoist",
          "ext-1",
          "importing",
          "__pending__",
        ])
      );
    });

    it("throws when no matching importing row", async () => {
      executeFn.mockResolvedValueOnce(0);
      await expect(
        store.attachFeedbackToImportSlot("proj-1", "todoist", "ext-1", "fb-1")
      ).rejects.toThrow("Failed to attach feedback");
    });
  });

  describe("promoteImportSlotToPendingDelete", () => {
    it("sets import_status pending_delete when row is importing with feedback id", async () => {
      executeFn.mockResolvedValueOnce(1);
      await store.promoteImportSlotToPendingDelete("proj-1", "todoist", "ext-1", "fb-1");
      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("SET import_status = $1, last_error = $2"),
        expect.arrayContaining([
          "pending_delete",
          null,
          expect.any(String),
          "proj-1",
          "todoist",
          "ext-1",
          "importing",
          "fb-1",
        ])
      );
    });

    it("is idempotent when already pending_delete with same feedback", async () => {
      executeFn.mockResolvedValueOnce(0);
      queryOneFn.mockResolvedValueOnce(
        makeLedgerRow({ import_status: "pending_delete", feedback_id: "fb-1" })
      );
      await expect(
        store.promoteImportSlotToPendingDelete("proj-1", "todoist", "ext-1", "fb-1")
      ).resolves.toBeUndefined();
    });
  });

  describe("reconcileImportAfterFeedback", () => {
    it("promotes importing row in one update (idempotent if already pending_delete)", async () => {
      executeFn.mockResolvedValueOnce(1);
      await store.reconcileImportAfterFeedback("proj-1", "todoist", "ext-1", "fb-1");
      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining(
          "SET feedback_id = $1, import_status = $2, last_error = $3, updated_at = $4"
        ),
        expect.arrayContaining([
          "fb-1",
          "pending_delete",
          null,
          expect.any(String),
          "proj-1",
          "todoist",
          "ext-1",
          "importing",
        ])
      );
    });

    it("no-ops when already reconciled to pending_delete", async () => {
      executeFn.mockResolvedValueOnce(0);
      queryOneFn.mockResolvedValueOnce(
        makeLedgerRow({ import_status: "pending_delete", feedback_id: "fb-1" })
      );
      await expect(
        store.reconcileImportAfterFeedback("proj-1", "todoist", "ext-1", "fb-1")
      ).resolves.toBeUndefined();
    });
  });

  describe("finalizeImportSlot", () => {
    it("runs attach then promote", async () => {
      executeFn.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
      await store.finalizeImportSlot("proj-1", "todoist", "ext-1", "fb-1");
      expect(executeFn).toHaveBeenCalledTimes(2);
      expect(executeFn.mock.calls[0][0]).toContain("SET feedback_id = $1, updated_at = $2");
      expect(executeFn.mock.calls[1][0]).toContain("SET import_status = $1, last_error = $2");
    });

    it("throws when attach finds no row", async () => {
      executeFn.mockResolvedValueOnce(0);
      await expect(store.finalizeImportSlot("proj-1", "todoist", "ext-1", "fb-1")).rejects.toThrow(
        "Failed to attach feedback"
      );
    });
  });

  describe("abandonImportSlot", () => {
    it("deletes importing row only when feedback_id is still pending placeholder", async () => {
      await store.abandonImportSlot("proj-1", "todoist", "ext-1");
      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM integration_import_ledger"),
        ["proj-1", "todoist", "ext-1", "importing", "__pending__"]
      );
    });
  });

  describe("recordImport", () => {
    it("returns true when insert succeeds (no existing record)", async () => {
      queryOneFn.mockResolvedValueOnce(undefined);
      const result = await store.recordImport("proj-1", "todoist", "ext-1", "fb-1");
      expect(result).toBe(true);
      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO integration_import_ledger"),
        expect.arrayContaining(["proj-1", "todoist", "ext-1", "fb-1", "pending_delete"])
      );
    });

    it("returns false when record already exists (duplicate)", async () => {
      queryOneFn.mockResolvedValueOnce({ id: 1 });
      const result = await store.recordImport("proj-1", "todoist", "ext-1", "fb-1");
      expect(result).toBe(false);
      expect(executeFn).not.toHaveBeenCalled();
    });
  });

  describe("getPendingDeletes", () => {
    it("returns pending and failed_delete entries ordered by created_at", async () => {
      queryFn.mockResolvedValueOnce([
        makeLedgerRow({ id: 1, import_status: "pending_delete" }),
        makeLedgerRow({ id: 2, import_status: "failed_delete" }),
      ]);
      const result = await store.getPendingDeletes("proj-1", "todoist");
      expect(result).toHaveLength(2);
      expect(result[0].import_status).toBe("pending_delete");
      expect(result[1].import_status).toBe("failed_delete");
      expect(queryFn).toHaveBeenCalledWith(expect.stringContaining("pending_delete"), [
        "proj-1",
        "todoist",
      ]);
    });

    it("respects limit parameter", async () => {
      queryFn.mockResolvedValueOnce([makeLedgerRow()]);
      await store.getPendingDeletes("proj-1", "todoist", 10);
      expect(queryFn).toHaveBeenCalledWith(expect.stringContaining("LIMIT $3"), [
        "proj-1",
        "todoist",
        10,
      ]);
    });

    it("returns empty array when no pending deletes", async () => {
      queryFn.mockResolvedValueOnce([]);
      const result = await store.getPendingDeletes("proj-1", "todoist");
      expect(result).toEqual([]);
    });
  });

  describe("markCompleted", () => {
    it("updates import_status to completed", async () => {
      await store.markCompleted("42");
      expect(executeFn).toHaveBeenCalledWith(expect.stringContaining("import_status = $1"), [
        "completed",
        expect.any(String),
        "42",
      ]);
    });
  });

  describe("markFailedDelete", () => {
    it("updates status to failed_delete with error and increments retry_count", async () => {
      await store.markFailedDelete("42", "API timeout");
      const call = executeFn.mock.calls[0];
      expect(call[0]).toContain("import_status = $1");
      expect(call[0]).toContain("retry_count = retry_count + 1");
      expect(call[1]).toEqual(["failed_delete", "API timeout", expect.any(String), "42"]);
    });
  });

  describe("hasBeenImported", () => {
    it("returns true when record exists", async () => {
      queryOneFn.mockResolvedValueOnce({ "?column?": 1 });
      const result = await store.hasBeenImported("proj-1", "todoist", "ext-1");
      expect(result).toBe(true);
    });

    it("returns false when no record", async () => {
      queryOneFn.mockResolvedValueOnce(undefined);
      const result = await store.hasBeenImported("proj-1", "todoist", "ext-1");
      expect(result).toBe(false);
    });
  });

  describe("listImportedExternalIds", () => {
    it("returns external ids only for finalized import statuses (not importing)", async () => {
      queryFn.mockResolvedValueOnce([{ external_item_id: "a" }, { external_item_id: "b" }]);
      const result = await store.listImportedExternalIds("proj-1", "todoist");
      expect(result).toEqual(new Set(["a", "b"]));
      expect(queryFn).toHaveBeenCalledWith(
        expect.stringContaining(
          "import_status IN ('pending_delete', 'completed', 'failed_delete')"
        ),
        ["proj-1", "todoist"]
      );
    });
  });

  describe("mergeConnectionConfig", () => {
    it("merges JSON patch into existing config", async () => {
      queryOneFn.mockResolvedValueOnce({ config: '{"pollIntervalSeconds":60}' });
      await store.mergeConnectionConfig("conn-1", { todoistPendingBackfill: true });
      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE integration_connections SET config"),
        expect.arrayContaining([
          expect.stringContaining("todoistPendingBackfill"),
          expect.any(String),
          "conn-1",
        ])
      );
      const args = executeFn.mock.calls[0][1] as unknown[];
      expect(JSON.parse(args[0] as string)).toEqual({
        pollIntervalSeconds: 60,
        todoistPendingBackfill: true,
      });
    });
  });
});

describe("IntegrationStoreService — singleton export", () => {
  it("exports integrationStore singleton", async () => {
    const mod = await import("../services/integration-store.service.js");
    expect(mod.integrationStore).toBeInstanceOf(IntegrationStoreService);
  });
});
