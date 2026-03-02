import type { Task } from "@opensprint/shared";

export interface PaginatedTaskList {
  items: Task[];
  total: number;
}

export type TaskListResponse = Task[] | PaginatedTaskList | undefined;

export function normalizeTaskListResponse(data: TaskListResponse): Task[] {
  if (Array.isArray(data)) {
    return data;
  }
  if (data && typeof data === "object" && "items" in data) {
    return data.items ?? [];
  }
  return [];
}
