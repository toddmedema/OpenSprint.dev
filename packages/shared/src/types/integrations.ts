/** Integration provider identifiers. */
export type IntegrationProvider = "todoist" | "github" | "slack" | "webhook";

/** Connection health status for an integration. */
export type IntegrationConnectionStatus = "active" | "needs_reconnect" | "disabled";

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

// ---------------------------------------------------------------------------
// Provider-agnostic intake types
// ---------------------------------------------------------------------------

/** All supported provider identifiers as a constant array (for validation). */
export const INTEGRATION_PROVIDERS: readonly IntegrationProvider[] = [
  "todoist",
  "github",
  "slack",
  "webhook",
] as const;

/** Triage lifecycle status for an intake item. */
export type IntakeTriageStatus = "new" | "triaged" | "converted" | "ignored";

/** Action to perform when converting an intake item. */
export type IntakeConvertAction =
  | "to_feedback"
  | "to_task_draft"
  | "link_existing"
  | "ignore";

/** AI-generated triage suggestion for an intake item. */
export interface IntakeTriageSuggestion {
  priority: "critical" | "high" | "medium" | "low";
  labels: string[];
  duplicateOf?: string;
  duplicateConfidence?: number;
  recommendedAction: IntakeConvertAction;
  reasoning?: string;
  confidence: number;
}

/** Normalized intake item from any integration provider. */
export interface IntakeItem {
  id: string;
  project_id: string;
  provider: IntegrationProvider;
  external_item_id: string;
  source_ref: string | null;
  title: string;
  body: string | null;
  author: string | null;
  labels: string[];
  triage_status: IntakeTriageStatus;
  triage_suggestion: IntakeTriageSuggestion | null;
  converted_feedback_id: string | null;
  converted_task_id: string | null;
  external_created_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Filters for querying intake items. */
export interface IntakeListFilters {
  provider?: IntegrationProvider;
  triageStatus?: IntakeTriageStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

/** Response for GET intake list. */
export interface IntakeListResponse {
  items: IntakeItem[];
  total: number;
}

/** Request body for converting an intake item. */
export interface IntakeConvertRequest {
  action: IntakeConvertAction;
  /** When action is "link_existing", the task ID to link to. */
  linkTaskId?: string;
}

/** Response from converting an intake item. */
export interface IntakeConvertResponse {
  intakeItemId: string;
  action: IntakeConvertAction;
  feedbackId?: string;
  taskId?: string;
}

/** Request body for bulk intake actions. */
export interface IntakeBulkActionRequest {
  itemIds: string[];
  action: IntakeConvertAction;
  dryRun?: boolean;
}

/** Response from bulk intake actions. */
export interface IntakeBulkActionResponse {
  processed: number;
  errors: number;
  results: IntakeConvertResponse[];
}

/** Provider-agnostic status response for any integration connection. */
export interface IntegrationStatusResponse {
  connected: boolean;
  provider: IntegrationProvider;
  user?: { id: string; email?: string };
  selectedSource?: { id: string; name: string };
  lastSyncAt?: string;
  lastError?: string;
  status: IntegrationConnectionStatus;
  importedCount?: number;
}

/** POST /integrations/:provider/oauth/start response */
export interface IntegrationOAuthStartResponse {
  authorizationUrl: string;
}

/** Source option from a provider (repo, channel, project, etc.). */
export interface IntegrationSourceOption {
  id: string;
  name: string;
  itemCount?: number;
}

/** PUT /integrations/:provider/source request body */
export interface IntegrationSourceSelectionRequest {
  sourceId: string;
}

/** POST /integrations/:provider/sync response */
export interface IntegrationSyncResponse {
  imported: number;
  errors: number;
}
