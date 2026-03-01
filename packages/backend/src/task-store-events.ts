/**
 * Wires TaskStoreService to emit task create/update/close events via a broadcast callback.
 * Called from index.ts at startup; tests can call with mock broadcast to verify events.
 */
import type { TaskEventPayload, ServerEvent } from "@opensprint/shared";
import { taskStore, type StoredTask } from "./services/task-store.service.js";

function storedTaskToPayload(task: StoredTask): TaskEventPayload {
  const parentDep = (task.dependencies ?? []).find((d) => d.type === "parent-child");
  const parentId = parentDep?.depends_on_id ?? null;
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? null,
    issue_type: task.issue_type ?? (task as { type?: string }).type ?? "task",
    status: task.status as string,
    priority: task.priority ?? 2,
    assignee: task.assignee ?? null,
    labels: (task.labels ?? []) as string[],
    created_at: task.created_at,
    updated_at: task.updated_at,
    close_reason: task.close_reason ?? null,
    parentId: parentId ?? null,
  };
}

export type BroadcastFn = (projectId: string, event: ServerEvent) => void;

export function wireTaskStoreEvents(broadcast: BroadcastFn): void {
  taskStore.setOnTaskChange((projectId, changeType, task) => {
    if (changeType === "create") {
      broadcast(projectId, {
        type: "task.created",
        taskId: task.id,
        task: storedTaskToPayload(task),
      });
    } else if (changeType === "update") {
      broadcast(projectId, {
        type: "task.updated",
        taskId: task.id,
        status: task.status as string,
        assignee: task.assignee ?? null,
        priority: task.priority,
        blockReason: (task as StoredTask & { block_reason?: string }).block_reason ?? null,
        title: task.title,
        description: task.description ?? undefined,
      });
    } else {
      broadcast(projectId, {
        type: "task.closed",
        taskId: task.id,
        task: storedTaskToPayload(task),
      });
    }
  });
}
