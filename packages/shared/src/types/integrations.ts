/** Integration provider identifiers. Extensible union for future providers. */
export type IntegrationProvider = "todoist";

/** Connection health status for an integration. */
export type IntegrationConnectionStatus =
  | "active"
  | "needs_reconnect"
  | "disabled";

/** Lifecycle status of an imported external item in the ledger. */
export type ImportStatus = "importing" | "pending_delete" | "completed" | "failed_delete";

/** Mirrors DB row for integration_connections (excludes encrypted token fields). */
export interface IntegrationConnection {
  id: string;
  project_id: string;
  provider: IntegrationProvider;
  provider_user_id: string | null;
  provider_user_email: string | null;
  provider_resource_id: string | null;
  provider_resource_name: string | null;
  scopes: string | null;
  status: IntegrationConnectionStatus;
  last_sync_at: string | null;
  last_error: string | null;
  config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** Tracks each imported external item to ensure idempotency and crash recovery. */
export interface IntegrationImportLedgerEntry {
  id: string;
  project_id: string;
  provider: IntegrationProvider;
  external_item_id: string;
  feedback_id: string;
  import_status: ImportStatus;
  last_error: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Todoist-specific API contract types
// ---------------------------------------------------------------------------

/** GET /integrations/todoist/status response */
export interface TodoistIntegrationStatus {
  connected: boolean;
  todoistUser?: { id: string; email?: string };
  selectedProject?: { id: string; name: string };
  lastSyncAt?: string;
  lastError?: string;
  status: IntegrationConnectionStatus;
}

/** Todoist project info returned by the project picker endpoint. */
export interface TodoistProjectInfo {
  id: string;
  name: string;
  taskCount?: number;
}

/** POST /integrations/todoist/oauth/start response */
export interface TodoistOAuthStartResponse {
  authorizationUrl: string;
}

/** Result payload returned after a sync cycle. */
export interface TodoistSyncResult {
  imported: number;
  errors: number;
}

/** POST /integrations/todoist/project request body */
export interface TodoistProjectSelectionRequest {
  todoistProjectId: string;
}
