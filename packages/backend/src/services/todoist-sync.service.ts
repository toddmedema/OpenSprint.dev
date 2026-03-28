/**
 * Core Todoist sync pipeline — fetches tasks from a connected Todoist project,
 * creates feedback items, and deletes the originals from Todoist.
 */

import type { FeedbackItem, FeedbackSubmitRequest, TodoistSyncResult } from "@opensprint/shared";
import type { Task } from "@doist/todoist-api-typescript";
import {
  TodoistApiClient,
  TodoistAuthError,
  TodoistRateLimitError,
} from "./todoist-api-client.service.js";
import type { IntegrationStoreService } from "./integration-store.service.js";
import type { TokenEncryptionService } from "./token-encryption.service.js";
import { taskStore } from "./task-store.service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("todoist-sync");

const MAX_TASKS_PER_CYCLE = 50;
const PENDING_DELETE_RETRY_LIMIT = 20;

/**
 * Map Todoist priority (1=normal … 4=urgent) to Open Sprint user_priority
 * (0=Critical, 1=High, 2=Medium, 3=Low).
 */
function mapTodoistPriority(todoistPriority: number): number {
  switch (todoistPriority) {
    case 4: return 0; // Critical
    case 3: return 1; // High
    case 2: return 2; // Medium
    default: return 3; // Low (includes priority 1 = normal)
  }
}

function buildFeedbackText(task: Task): string {
  let text = task.content;
  if (task.description && task.description.trim().length > 0) {
    text += "\n" + task.description.trim();
  }
  return text;
}

export interface TodoistSyncDeps {
  integrationStore: IntegrationStoreService;
  submitFeedback: (projectId: string, body: FeedbackSubmitRequest) => Promise<FeedbackItem>;
  tokenEncryption: TokenEncryptionService;
}

export class TodoistSyncService {
  private deps: TodoistSyncDeps;

  constructor(deps: TodoistSyncDeps) {
    this.deps = deps;
  }

  async runSync(connectionId: string): Promise<TodoistSyncResult> {
    const result: TodoistSyncResult = { imported: 0, errors: 0 };

    log.info("Sync started", { connectionId });

    // 1. Load connection
    const connection = await this.deps.integrationStore.getConnectionById(connectionId);
    if (!connection) {
      log.warn("Connection not found, aborting sync", { connectionId });
      return result;
    }

    if (connection.status !== "active") {
      log.warn("Connection not active, aborting sync", { connectionId, status: connection.status });
      return result;
    }

    const projectId = connection.project_id;
    const providerResourceId = connection.provider_resource_id;

    if (!providerResourceId) {
      log.warn("No Todoist project selected, aborting sync", { connectionId, projectId });
      return result;
    }

    // 2. Decrypt token and instantiate client
    let todoistClient: TodoistApiClient;
    try {
      const encryptedToken = await this.deps.integrationStore.getEncryptedTokenById(connectionId);
      if (!encryptedToken) {
        log.error("No encrypted token found for connection", { connectionId });
        await this.deps.integrationStore.updateLastSync(
          connectionId,
          new Date().toISOString(),
          "No access token stored"
        );
        return result;
      }
      const accessToken = this.deps.tokenEncryption.decryptToken(encryptedToken);
      todoistClient = new TodoistApiClient(accessToken);
    } catch (err) {
      log.error("Failed to decrypt token", { connectionId, error: String(err) });
      await this.deps.integrationStore.updateLastSync(
        connectionId,
        new Date().toISOString(),
        "Token decryption failed"
      );
      return result;
    }

    try {
      // 3. Fetch tasks
      const allTasks = await todoistClient.getTasks(providerResourceId);

      // 4. Sort by addedAt ascending
      allTasks.sort((a, b) => {
        const aDate = a.addedAt ?? "";
        const bDate = b.addedAt ?? "";
        return aDate.localeCompare(bDate);
      });

      // 5. Cap at MAX_TASKS_PER_CYCLE
      const tasksToProcess = allTasks.slice(0, MAX_TASKS_PER_CYCLE);

      // 6. Process each task
      for (const task of tasksToProcess) {
        try {
          const imported = await this.processTask(projectId, providerResourceId, connectionId, task, todoistClient);
          if (imported) result.imported++;
        } catch (err) {
          if (err instanceof TodoistAuthError) throw err;
          if (err instanceof TodoistRateLimitError) throw err;
          log.error("Failed to process task", {
            connectionId,
            taskId: task.id,
            error: String(err),
          });
          result.errors++;
        }
      }

      // 7. Retry pending deletes
      await this.retryPendingDeletes(projectId, todoistClient);

      // 8. Update last_sync_at, clear error
      await this.deps.integrationStore.updateLastSync(
        connectionId,
        new Date().toISOString(),
        null
      );

      log.info("Sync completed", {
        connectionId,
        projectId,
        imported: result.imported,
        errors: result.errors,
      });
    } catch (err) {
      // 9. Handle auth error
      if (err instanceof TodoistAuthError) {
        log.error("Todoist auth error — marking needs_reconnect", {
          connectionId,
          error: err.message,
        });
        await this.deps.integrationStore.updateConnectionStatus(
          connectionId,
          "needs_reconnect",
          err.message
        );
        return result;
      }

      // 10. Handle rate limit
      if (err instanceof TodoistRateLimitError) {
        log.warn("Todoist rate limited — stopping this cycle", {
          connectionId,
          retryAfter: err.retryAfter,
        });
        await this.deps.integrationStore.updateLastSync(
          connectionId,
          new Date().toISOString(),
          `Rate limited (retry after ${err.retryAfter}s)`
        );
        return result;
      }

      // Unexpected error
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error("Unexpected sync error", { connectionId, error: errMsg });
      await this.deps.integrationStore.updateLastSync(
        connectionId,
        new Date().toISOString(),
        errMsg
      );
    }

    return result;
  }

  private async processTask(
    projectId: string,
    providerResourceId: string,
    connectionId: string,
    task: Task,
    todoistClient: TodoistApiClient,
  ): Promise<boolean> {
    // 6a. Check if already imported
    const alreadyImported = await this.deps.integrationStore.hasBeenImported(
      projectId,
      "todoist",
      task.id
    );
    if (alreadyImported) return false;

    // 6b. Build submit payload
    const body: FeedbackSubmitRequest = {
      text: buildFeedbackText(task),
      priority: mapTodoistPriority(task.priority),
    };

    // 6c. Create feedback item
    const feedbackItem = await this.deps.submitFeedback(projectId, body);

    // Store provenance in extra column
    const provenance = {
      source: "todoist",
      todoistTaskId: task.id,
      todoistProjectId: providerResourceId,
      importedAt: new Date().toISOString(),
      labels: task.labels,
    };
    await taskStore.runWrite(async (client) => {
      const existing = await client.queryOne(
        "SELECT extra FROM feedback WHERE id = $1 AND project_id = $2",
        [feedbackItem.id, projectId]
      );
      const currentExtra = existing
        ? JSON.parse((existing as { extra: string }).extra || "{}")
        : {};
      const merged = { ...currentExtra, ...provenance };
      await client.execute(
        "UPDATE feedback SET extra = $1 WHERE id = $2 AND project_id = $3",
        [JSON.stringify(merged), feedbackItem.id, projectId]
      );
    });

    // 6d. Record in ledger
    const recorded = await this.deps.integrationStore.recordImport(
      projectId,
      "todoist",
      task.id,
      feedbackItem.id
    );
    if (!recorded) {
      return true;
    }

    // 6e. Delete task from Todoist
    await this.deleteAndUpdateLedger(projectId, task.id, todoistClient);

    return true;
  }

  private async deleteAndUpdateLedger(
    projectId: string,
    externalItemId: string,
    todoistClient: TodoistApiClient,
  ): Promise<void> {
    const entries = await this.deps.integrationStore.getPendingDeletes(projectId, "todoist", 1);
    const entry = entries.find((e) => e.external_item_id === externalItemId);
    if (!entry) return;

    try {
      await todoistClient.deleteTask(externalItemId);
      await this.deps.integrationStore.markCompleted(entry.id);
      log.info("Todoist task deleted successfully", { projectId, externalItemId });
    } catch (err) {
      if (err instanceof TodoistAuthError || err instanceof TodoistRateLimitError) throw err;
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.deps.integrationStore.markFailedDelete(entry.id, errMsg);
      log.warn("Failed to delete Todoist task", { projectId, externalItemId, error: errMsg });
    }
  }

  private async retryPendingDeletes(
    projectId: string,
    todoistClient: TodoistApiClient,
  ): Promise<void> {
    const pendingDeletes = await this.deps.integrationStore.getPendingDeletes(
      projectId,
      "todoist",
      PENDING_DELETE_RETRY_LIMIT
    );

    for (const entry of pendingDeletes) {
      try {
        await todoistClient.deleteTask(entry.external_item_id);
        await this.deps.integrationStore.markCompleted(entry.id);
        log.info("Retry delete succeeded", {
          projectId,
          externalItemId: entry.external_item_id,
        });
      } catch (err) {
        if (err instanceof TodoistAuthError || err instanceof TodoistRateLimitError) throw err;
        const errMsg = err instanceof Error ? err.message : String(err);
        await this.deps.integrationStore.markFailedDelete(entry.id, errMsg);
        log.warn("Retry delete failed", {
          projectId,
          externalItemId: entry.external_item_id,
          error: errMsg,
        });
      }
    }
  }
}
