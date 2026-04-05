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

vi.mock("../services/task-store.service.js", () => ({
  taskStore: {
    getDb: vi.fn().mockImplementation(async () => mockDb),
    runWrite: vi
      .fn()
      .mockImplementation(async (fn: (c: DbClient) => Promise<unknown>) => fn(mockDb)),
  },
}));

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

describe("IntegrationStoreService — integration_connections", () => {
  describe("upsertConnection", () => {
    it("inserts a new row and returns it", async () => {
      const row = makeConnectionRow();
      queryOneFn
        .mockResolvedValueOnce(undefined) // no existing row
        .mockResolvedValueOnce(row); // fetched after insert

      const result = await store.upsertConnection({
        project_id: "proj-1",
        provider: "todoist",
        access_token_enc: "enc-token",
        scopes: "data:read_write,data:delete",
      });

      expect(result.id).toBe("conn-1");
      expect(result.provider).toBe("todoist");
      expect(result.status).toBe("active");
      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO integration_connections"),
        expect.any(Array)
      );
    });

    it("updates fields when called again with same (projectId, provider)", async () => {
      const updatedRow = makeConnectionRow({
        access_token_enc: "new-enc-token",
        provider_user_email: "new@example.com",
      });
      queryOneFn
        .mockResolvedValueOnce({
          id: "conn-1",
          config: '{"pollIntervalSeconds":60}',
        }) // existing row found
        .mockResolvedValueOnce(updatedRow); // fetched after update

      const result = await store.upsertConnection({
        project_id: "proj-1",
        provider: "todoist",
        access_token_enc: "new-enc-token",
        provider_user_email: "new@example.com",
      });

      expect(result.id).toBe("conn-1");
      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE integration_connections"),
        expect.any(Array)
      );
    });

    it("throws when result row is missing after upsert", async () => {
      queryOneFn
        .mockResolvedValueOnce(undefined) // no existing
        .mockResolvedValueOnce(undefined); // not found after insert

      await expect(
        store.upsertConnection({
          project_id: "proj-1",
          provider: "todoist",
          access_token_enc: "token",
        })
      ).rejects.toThrow("Failed to upsert");
    });
  });

  describe("getConnection", () => {
    it("returns null when no row exists", async () => {
      queryOneFn.mockResolvedValueOnce(undefined);

      const result = await store.getConnection("proj-1", "todoist");

      expect(result).toBeNull();
      expect(queryOneFn).toHaveBeenCalledWith(
        expect.stringContaining("FROM integration_connections"),
        ["proj-1", "todoist"]
      );
    });

    it("returns the connection after insert", async () => {
      queryOneFn.mockResolvedValueOnce(makeConnectionRow());

      const result = await store.getConnection("proj-1", "todoist");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("conn-1");
      expect(result!.provider).toBe("todoist");
      expect(result!.status).toBe("active");
      expect(result!.config).toEqual({ pollIntervalSeconds: 60 });
    });

    it("returns null config when db config is null", async () => {
      queryOneFn.mockResolvedValueOnce(makeConnectionRow({ config: null }));

      const result = await store.getConnection("proj-1", "todoist");

      expect(result!.config).toBeNull();
    });
  });

  describe("getActiveConnections", () => {
    it("returns only active rows", async () => {
      queryFn.mockResolvedValueOnce([
        makeConnectionRow({ id: "c1", status: "active" }),
        makeConnectionRow({ id: "c2", status: "active" }),
      ]);

      const result = await store.getActiveConnections();

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe("active");
      expect(result[1].status).toBe("active");
      expect(queryFn).toHaveBeenCalledWith(expect.stringContaining("status = $1"), ["active"]);
    });

    it("filters by provider when specified", async () => {
      queryFn.mockResolvedValueOnce([makeConnectionRow()]);

      const result = await store.getActiveConnections("todoist");

      expect(result).toHaveLength(1);
      expect(queryFn).toHaveBeenCalledWith(expect.stringContaining("provider = $2"), [
        "active",
        "todoist",
      ]);
    });

    it("returns empty array when no active connections exist", async () => {
      queryFn.mockResolvedValueOnce([]);

      const result = await store.getActiveConnections();

      expect(result).toEqual([]);
    });
  });

  describe("updateConnectionStatus", () => {
    it("changes status and sets lastError", async () => {
      await store.updateConnectionStatus("conn-1", "needs_reconnect", "Token revoked");

      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE integration_connections SET status"),
        ["needs_reconnect", "Token revoked", expect.any(String), "conn-1"]
      );
    });

    it("clears lastError when null", async () => {
      await store.updateConnectionStatus("conn-1", "active");

      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE integration_connections SET status"),
        ["active", null, expect.any(String), "conn-1"]
      );
    });

    it("clears lastError when explicitly passed as null", async () => {
      await store.updateConnectionStatus("conn-1", "active", null);

      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE integration_connections SET status"),
        ["active", null, expect.any(String), "conn-1"]
      );
    });
  });

  describe("updateLastSync", () => {
    it("updates last_sync_at and clears last_error by default", async () => {
      const syncAt = "2025-06-01T12:00:00.000Z";
      await store.updateLastSync("conn-1", syncAt);

      expect(executeFn).toHaveBeenCalledWith(expect.stringContaining("last_sync_at"), [
        syncAt,
        null,
        expect.any(String),
        "conn-1",
      ]);
    });

    it("updates last_sync_at and optionally sets last_error", async () => {
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
    it("removes the row", async () => {
      await store.deleteConnection("proj-1", "todoist");

      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM integration_connections"),
        ["proj-1", "todoist"]
      );
    });

    it("subsequent getConnection returns null", async () => {
      await store.deleteConnection("proj-1", "todoist");

      queryOneFn.mockResolvedValueOnce(undefined);
      const result = await store.getConnection("proj-1", "todoist");

      expect(result).toBeNull();
    });
  });
});

// ─── integration_import_ledger ───

describe("IntegrationStoreService — integration_import_ledger", () => {
  describe("recordImport", () => {
    it("inserts and returns true when no prior record", async () => {
      queryOneFn.mockResolvedValueOnce(undefined); // no existing

      const result = await store.recordImport("proj-1", "todoist", "ext-1", "fb-1");

      expect(result).toBe(true);
      expect(executeFn).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO integration_import_ledger"),
        expect.arrayContaining(["proj-1", "todoist", "ext-1", "fb-1", "pending_delete"])
      );
    });

    it("returns false for duplicate (projectId, provider, externalItemId)", async () => {
      queryOneFn.mockResolvedValueOnce({ id: 1 }); // already exists

      const result = await store.recordImport("proj-1", "todoist", "ext-1", "fb-1");

      expect(result).toBe(false);
      expect(executeFn).not.toHaveBeenCalled();
    });
  });

  describe("getPendingDeletes", () => {
    it("returns rows with import_status pending_delete or failed_delete", async () => {
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

      await store.getPendingDeletes("proj-1", "todoist", 5);

      expect(queryFn).toHaveBeenCalledWith(expect.stringContaining("LIMIT $3"), [
        "proj-1",
        "todoist",
        5,
      ]);
    });

    it("orders by created_at ascending", async () => {
      queryFn.mockResolvedValueOnce([]);

      await store.getPendingDeletes("proj-1", "todoist");

      expect(queryFn).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY created_at ASC"),
        expect.any(Array)
      );
    });

    it("returns empty array when no pending deletes exist", async () => {
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
    it("updates import_status to failed_delete, sets last_error, increments retry_count", async () => {
      await store.markFailedDelete("42", "API timeout");

      const call = executeFn.mock.calls[0];
      expect(call[0]).toContain("import_status = $1");
      expect(call[0]).toContain("last_error = $2");
      expect(call[0]).toContain("retry_count = retry_count + 1");
      expect(call[1]).toEqual(["failed_delete", "API timeout", expect.any(String), "42"]);
    });
  });

  describe("hasBeenImported", () => {
    it("returns false initially (no record)", async () => {
      queryOneFn.mockResolvedValueOnce(undefined);

      const result = await store.hasBeenImported("proj-1", "todoist", "ext-1");

      expect(result).toBe(false);
    });

    it("returns true after recordImport", async () => {
      queryOneFn.mockResolvedValueOnce({ "?column?": 1 });

      const result = await store.hasBeenImported("proj-1", "todoist", "ext-1");

      expect(result).toBe(true);
    });
  });
});
