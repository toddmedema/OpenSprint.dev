import { createSlice, type PayloadAction, type AnyAction } from "@reduxjs/toolkit";
import type { Task, TaskSummary } from "@opensprint/shared";
import { mapStatusToKanban } from "@opensprint/shared";

/** Fulfilled action shape for execute thunks (task list/detail/updates) */
interface ExecuteFulfilledAction {
  meta: { arg: string | { projectId: string; taskId?: string } };
  payload: Task[] | Task | { tasks: Task[] } | { task: Task };
}

export interface TaskRegistryState {
  byProject: Record<string, Record<string, TaskSummary>>;
}

const initialState: TaskRegistryState = {
  byProject: {},
};

function mergeTasksIntoState(
  state: TaskRegistryState,
  projectId: string,
  tasks: Task[]
): void {
  if (!state.byProject[projectId]) {
    state.byProject[projectId] = {};
  }
  for (const task of tasks) {
    state.byProject[projectId][task.id] = {
      title: task.title,
      kanbanColumn: task.kanbanColumn,
      priority: task.priority,
    };
  }
}

function mergeTaskIntoState(
  state: TaskRegistryState,
  projectId: string,
  task: Task
): void {
  if (!state.byProject[projectId]) {
    state.byProject[projectId] = {};
  }
  state.byProject[projectId][task.id] = {
    title: task.title,
    kanbanColumn: task.kanbanColumn,
    priority: task.priority,
  };
}

const taskRegistrySlice = createSlice({
  name: "taskRegistry",
  initialState,
  reducers: {
    mergeTasks(state, action: PayloadAction<{ projectId: string; tasks: Task[] }>) {
      const { projectId, tasks } = action.payload;
      mergeTasksIntoState(state, projectId, tasks);
    },
    mergeTask(state, action: PayloadAction<{ projectId: string; task: Task }>) {
      const { projectId, task } = action.payload;
      mergeTaskIntoState(state, projectId, task);
    },
    mergeTaskUpdate(
      state,
      action: PayloadAction<{
        projectId: string;
        taskId: string;
        status?: string;
        assignee?: string | null;
        priority?: number;
      }>
    ) {
      const { projectId, taskId, status, priority } = action.payload;
      const entry = state.byProject[projectId]?.[taskId];
      if (!entry) return;
      if (status !== undefined) {
        entry.kanbanColumn = mapStatusToKanban(status);
      }
      if (priority !== undefined) {
        entry.priority = priority as TaskSummary["priority"];
      }
    },
    clearRegistry(state) {
      state.byProject = {};
    },
  },
  extraReducers(builder) {
    builder
      .addCase("execute/fetchTasks.fulfilled", (state, action: AnyAction) => {
        const a = action as unknown as ExecuteFulfilledAction;
        const projectId = a.meta.arg as string;
        const tasks = a.payload as Task[];
        mergeTasksIntoState(state, projectId, tasks);
      })
      .addCase("execute/fetchTaskDetail.fulfilled", (state, action: AnyAction) => {
        const a = action as unknown as ExecuteFulfilledAction;
        const projectId = (a.meta.arg as { projectId: string }).projectId;
        const task = a.payload as Task;
        mergeTaskIntoState(state, projectId, task);
      })
      .addCase("execute/markTaskDone.fulfilled", (state, action: AnyAction) => {
        const a = action as unknown as ExecuteFulfilledAction;
        const projectId = (a.meta.arg as { projectId: string }).projectId;
        const tasks = (a.payload as { tasks: Task[] }).tasks;
        mergeTasksIntoState(state, projectId, tasks);
      })
      .addCase("execute/unblockTask.fulfilled", (state, action: AnyAction) => {
        const a = action as unknown as ExecuteFulfilledAction;
        const projectId = (a.meta.arg as { projectId: string }).projectId;
        const tasks = (a.payload as { tasks: Task[] }).tasks;
        mergeTasksIntoState(state, projectId, tasks);
      })
      .addCase("execute/updateTaskPriority.fulfilled", (state, action: AnyAction) => {
        const a = action as unknown as ExecuteFulfilledAction;
        const projectId = (a.meta.arg as { projectId: string }).projectId;
        const task = (a.payload as { task: Task }).task;
        mergeTaskIntoState(state, projectId, task);
      })
      .addCase("execute/resetExecute", (state) => {
        state.byProject = {};
      });
  },
});

export const { mergeTasks, mergeTask, mergeTaskUpdate, clearRegistry } =
  taskRegistrySlice.actions;

/** State shape expected by selectors (avoids circular dependency on store). taskRegistry may be missing in tests that omit the reducer. */
export type TaskRegistryRootState = { taskRegistry?: TaskRegistryState };

export function selectTaskSummariesByProject(
  state: TaskRegistryRootState,
  projectId: string
): Record<string, TaskSummary> {
  return state.taskRegistry?.byProject?.[projectId] ?? {};
}

export function selectTaskTitle(
  state: TaskRegistryRootState,
  projectId: string,
  taskId: string
): string | undefined {
  return state.taskRegistry?.byProject?.[projectId]?.[taskId]?.title;
}

export default taskRegistrySlice.reducer;
