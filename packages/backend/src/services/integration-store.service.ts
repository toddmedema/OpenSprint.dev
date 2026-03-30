/**
 * SQL-backed store for integration_connections and integration_import_ledger tables.
 * Uses taskStore.getDb() for reads and taskStore.runWrite() for writes.
 */

import { randomUUID } from "node:crypto";
import type {
  IntegrationProvider,
  IntegrationConnectionStatus,
  ImportStatus,
  IntegrationConnection,
  IntegrationImportLedgerEntry,
} from "@opensprint/shared";
import { taskStore } from "./task-store.service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("integration-store");
const IMPORT_SLOT_STALE_MS = 15 * 60 * 1000;
const PENDING_FEEDBACK_ID = "__pending__";

/** DB row shape for integration_connections (includes encrypted token columns). */
interface ConnectionRow {
  id: string;
  project_id: string;
  provider: string;
  provider_user_id: string | null;
  provider_user_email: string | null;
  provider_resource_id: string | null;
  provider_resource_name: string | null;
  access_token_enc: string;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  scopes: string | null;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
  config: string | null;
  created_at: string;
  updated_at: string;
}

/** DB row shape for integration_import_ledger. */
interface LedgerRow {
  id: number | string;
  project_id: string;
  provider: string;
  external_item_id: string;
  feedback_id: string;
  import_status: string;
  last_error: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

function connectionRowToPublic(row: ConnectionRow): IntegrationConnection {
  return {
    id: row.id,
    project_id: row.project_id,
    provider: row.provider as IntegrationProvider,
    provider_user_id: row.provider_user_id,
    provider_user_email: row.provider_user_email,
    provider_resource_id: row.provider_resource_id,
    provider_resource_name: row.provider_resource_name,
    scopes: row.scopes,
    status: row.status as IntegrationConnectionStatus,
    last_sync_at: row.last_sync_at,
    last_error: row.last_error,
    config: row.config ? (JSON.parse(row.config) as Record<string, unknown>) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function ledgerRowToEntry(row: LedgerRow): IntegrationImportLedgerEntry {
  return {
    id: String(row.id),
    project_id: row.project_id,
    provider: row.provider as IntegrationProvider,
    external_item_id: row.external_item_id,
    feedback_id: row.feedback_id,
    import_status: row.import_status as ImportStatus,
    last_error: row.last_error,
    retry_count: row.retry_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class IntegrationStoreService {
  // ─── integration_connections ───

  async getConnection(
    projectId: string,
    provider: IntegrationProvider
  ): Promise<IntegrationConnection | null> {
    const client = await taskStore.getDb();
    const row = await client.queryOne(
      "SELECT * FROM integration_connections WHERE project_id = $1 AND provider = $2",
      [projectId, provider]
    );
    return row ? connectionRowToPublic(row as unknown as ConnectionRow) : null;
  }

  async getActiveConnections(provider?: IntegrationProvider): Promise<IntegrationConnection[]> {
    const client = await taskStore.getDb();
    if (provider) {
      const rows = await client.query(
        "SELECT * FROM integration_connections WHERE status = $1 AND provider = $2",
        ["active", provider]
      );
      return (rows as unknown as ConnectionRow[]).map(connectionRowToPublic);
    }
    const rows = await client.query("SELECT * FROM integration_connections WHERE status = $1", [
      "active",
    ]);
    return (rows as unknown as ConnectionRow[]).map(connectionRowToPublic);
  }

  async upsertConnection(data: {
    project_id: string;
    provider: IntegrationProvider;
    provider_user_id?: string | null;
    provider_user_email?: string | null;
    provider_resource_id?: string | null;
    provider_resource_name?: string | null;
    access_token_enc: string;
    refresh_token_enc?: string | null;
    token_expires_at?: string | null;
    scopes?: string | null;
    status?: IntegrationConnectionStatus;
    config?: Record<string, unknown> | null;
  }): Promise<IntegrationConnection> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const status = data.status ?? "active";
    const configJson = data.config ? JSON.stringify(data.config) : "{}";

    let resultRow: IntegrationConnection | null = null;

    await taskStore.runWrite(async (client) => {
      const existing = await client.queryOne(
        "SELECT id FROM integration_connections WHERE project_id = $1 AND provider = $2",
        [data.project_id, data.provider]
      );

      if (existing) {
        await client.execute(
          `UPDATE integration_connections SET
            provider_user_id = $1,
            provider_user_email = $2,
            provider_resource_id = $3,
            provider_resource_name = $4,
            access_token_enc = $5,
            refresh_token_enc = $6,
            token_expires_at = $7,
            scopes = $8,
            status = $9,
            config = $10,
            updated_at = $11
          WHERE project_id = $12 AND provider = $13`,
          [
            data.provider_user_id ?? null,
            data.provider_user_email ?? null,
            data.provider_resource_id ?? null,
            data.provider_resource_name ?? null,
            data.access_token_enc,
            data.refresh_token_enc ?? null,
            data.token_expires_at ?? null,
            data.scopes ?? null,
            status,
            configJson,
            now,
            data.project_id,
            data.provider,
          ]
        );
      } else {
        await client.execute(
          `INSERT INTO integration_connections (
            id, project_id, provider, provider_user_id, provider_user_email,
            provider_resource_id, provider_resource_name, access_token_enc,
            refresh_token_enc, token_expires_at, scopes, status, config,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            id,
            data.project_id,
            data.provider,
            data.provider_user_id ?? null,
            data.provider_user_email ?? null,
            data.provider_resource_id ?? null,
            data.provider_resource_name ?? null,
            data.access_token_enc,
            data.refresh_token_enc ?? null,
            data.token_expires_at ?? null,
            data.scopes ?? null,
            status,
            configJson,
            now,
            now,
          ]
        );
      }

      const saved = await client.queryOne(
        "SELECT * FROM integration_connections WHERE project_id = $1 AND provider = $2",
        [data.project_id, data.provider]
      );
      resultRow = saved ? connectionRowToPublic(saved as unknown as ConnectionRow) : null;
    });

    if (!resultRow) {
      throw new Error("Failed to upsert integration connection");
    }

    log.info("Upserted integration connection", {
      projectId: data.project_id,
      provider: data.provider,
    });
    return resultRow;
  }

  async updateConnectionStatus(
    id: string,
    status: IntegrationConnectionStatus,
    lastError?: string | null
  ): Promise<void> {
    const now = new Date().toISOString();
    await taskStore.runWrite(async (client) => {
      await client.execute(
        `UPDATE integration_connections SET status = $1, last_error = $2, updated_at = $3 WHERE id = $4`,
        [status, lastError ?? null, now, id]
      );
    });
    log.info("Updated connection status", { id, status });
  }

  async updateLastSync(id: string, lastSyncAt: string, lastError?: string | null): Promise<void> {
    const now = new Date().toISOString();
    await taskStore.runWrite(async (client) => {
      await client.execute(
        `UPDATE integration_connections SET last_sync_at = $1, last_error = $2, updated_at = $3 WHERE id = $4`,
        [lastSyncAt, lastError ?? null, now, id]
      );
    });
  }

  async updateSelectedResource(
    id: string,
    resourceId: string,
    resourceName: string
  ): Promise<void> {
    const now = new Date().toISOString();
    await taskStore.runWrite(async (client) => {
      await client.execute(
        `UPDATE integration_connections
         SET provider_resource_id = $1, provider_resource_name = $2, updated_at = $3
         WHERE id = $4`,
        [resourceId, resourceName, now, id]
      );
    });
    log.info("Updated selected resource", { id, resourceId, resourceName });
  }

  async deleteConnection(projectId: string, provider: IntegrationProvider): Promise<void> {
    await taskStore.runWrite(async (client) => {
      await client.execute(
        "DELETE FROM integration_connections WHERE project_id = $1 AND provider = $2",
        [projectId, provider]
      );
    });
    log.info("Deleted integration connection", { projectId, provider });
  }

  async getConnectionById(id: string): Promise<IntegrationConnection | null> {
    const client = await taskStore.getDb();
    const row = await client.queryOne("SELECT * FROM integration_connections WHERE id = $1", [id]);
    return row ? connectionRowToPublic(row as unknown as ConnectionRow) : null;
  }

  async getEncryptedTokenById(id: string): Promise<string | null> {
    const client = await taskStore.getDb();
    const row = await client.queryOne(
      "SELECT access_token_enc FROM integration_connections WHERE id = $1",
      [id]
    );
    return row ? (row as unknown as ConnectionRow).access_token_enc : null;
  }

  // ─── integration_import_ledger ───

  /**
   * Record an import. Returns true if inserted, false if the item was already
   * recorded (duplicate per unique constraint on project_id+provider+external_item_id).
   */
  async recordImport(
    projectId: string,
    provider: IntegrationProvider,
    externalItemId: string,
    feedbackId: string
  ): Promise<boolean> {
    const now = new Date().toISOString();
    let inserted = false;

    await taskStore.runWrite(async (client) => {
      const existing = await client.queryOne(
        "SELECT id FROM integration_import_ledger WHERE project_id = $1 AND provider = $2 AND external_item_id = $3",
        [projectId, provider, externalItemId]
      );
      if (existing) {
        inserted = false;
        return;
      }
      await client.execute(
        `INSERT INTO integration_import_ledger (
          project_id, provider, external_item_id, feedback_id,
          import_status, retry_count, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [projectId, provider, externalItemId, feedbackId, "pending_delete", 0, now, now]
      );
      inserted = true;
    });

    if (inserted) {
      log.info("Recorded import in ledger", { projectId, provider, externalItemId, feedbackId });
    }
    return inserted;
  }

  /**
   * Atomically claim an import slot for an external item.
   * Returns false when another worker already claimed or imported it.
   */
  async claimImportSlot(
    projectId: string,
    provider: IntegrationProvider,
    externalItemId: string
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const staleCutoff = new Date(Date.now() - IMPORT_SLOT_STALE_MS).toISOString();
    let claimed = false;

    await taskStore.runWrite(async (client) => {
      // Recover from crashed workers that left an import slot in-progress.
      await client.execute(
        `DELETE FROM integration_import_ledger
         WHERE project_id = $1 AND provider = $2 AND external_item_id = $3
           AND import_status = $4 AND updated_at < $5`,
        [projectId, provider, externalItemId, "importing", staleCutoff]
      );

      const inserted = await client.execute(
        `INSERT INTO integration_import_ledger (
          project_id, provider, external_item_id, feedback_id,
          import_status, retry_count, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (project_id, provider, external_item_id) DO NOTHING`,
        [projectId, provider, externalItemId, PENDING_FEEDBACK_ID, "importing", 0, now, now]
      );
      claimed = inserted > 0;
    });

    return claimed;
  }

  /**
   * Finalize an already-claimed import slot after feedback creation succeeds.
   */
  async finalizeImportSlot(
    projectId: string,
    provider: IntegrationProvider,
    externalItemId: string,
    feedbackId: string
  ): Promise<void> {
    const now = new Date().toISOString();
    let updated = 0;
    await taskStore.runWrite(async (client) => {
      updated = await client.execute(
        `UPDATE integration_import_ledger
         SET feedback_id = $1, import_status = $2, last_error = $3, updated_at = $4
         WHERE project_id = $5 AND provider = $6 AND external_item_id = $7 AND import_status = $8`,
        [feedbackId, "pending_delete", null, now, projectId, provider, externalItemId, "importing"]
      );
    });
    if (updated === 0) {
      throw new Error(`Failed to finalize import slot for ${provider}:${externalItemId}`);
    }
  }

  /**
   * Release a claimed import slot when import side effects fail before finalize.
   */
  async abandonImportSlot(
    projectId: string,
    provider: IntegrationProvider,
    externalItemId: string
  ): Promise<void> {
    await taskStore.runWrite(async (client) => {
      await client.execute(
        `DELETE FROM integration_import_ledger
         WHERE project_id = $1 AND provider = $2 AND external_item_id = $3 AND import_status = $4`,
        [projectId, provider, externalItemId, "importing"]
      );
    });
  }

  async getPendingDeletes(
    projectId: string,
    provider: IntegrationProvider,
    limit?: number
  ): Promise<IntegrationImportLedgerEntry[]> {
    const client = await taskStore.getDb();
    let rows;
    if (limit != null) {
      rows = await client.query(
        `SELECT * FROM integration_import_ledger
         WHERE project_id = $1 AND provider = $2
           AND import_status IN ('pending_delete', 'failed_delete')
         ORDER BY created_at ASC
         LIMIT $3`,
        [projectId, provider, limit]
      );
    } else {
      rows = await client.query(
        `SELECT * FROM integration_import_ledger
         WHERE project_id = $1 AND provider = $2
           AND import_status IN ('pending_delete', 'failed_delete')
         ORDER BY created_at ASC`,
        [projectId, provider]
      );
    }
    return (rows as unknown as LedgerRow[]).map(ledgerRowToEntry);
  }

  async markCompleted(id: string): Promise<void> {
    const now = new Date().toISOString();
    await taskStore.runWrite(async (client) => {
      await client.execute(
        "UPDATE integration_import_ledger SET import_status = $1, updated_at = $2 WHERE id = $3",
        ["completed", now, id]
      );
    });
  }

  async markFailedDelete(id: string, error: string): Promise<void> {
    const now = new Date().toISOString();
    await taskStore.runWrite(async (client) => {
      await client.execute(
        `UPDATE integration_import_ledger
         SET import_status = $1, last_error = $2, retry_count = retry_count + 1, updated_at = $3
         WHERE id = $4`,
        ["failed_delete", error, now, id]
      );
    });
  }

  async hasBeenImported(
    projectId: string,
    provider: IntegrationProvider,
    externalItemId: string
  ): Promise<boolean> {
    const client = await taskStore.getDb();
    const row = await client.queryOne(
      "SELECT 1 FROM integration_import_ledger WHERE project_id = $1 AND provider = $2 AND external_item_id = $3 LIMIT 1",
      [projectId, provider, externalItemId]
    );
    return !!row;
  }
}

export const integrationStore = new IntegrationStoreService();
