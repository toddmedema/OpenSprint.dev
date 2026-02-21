import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { AgentSession, Task } from "@opensprint/shared";
import { mapStatusToKanban } from "@opensprint/shared";
import { api } from "../../api/client";
import { DEDUP_SKIP } from "../dedup";
import { setPlansAndGraph } from "./planSlice";
import { setDeliverToast } from "./websocketSlice";

/** Task display shape for kanban (subset of Task) */
export type TaskCard = Pick<
  Task,
  "id" | "title" | "kanbanColumn" | "priority" | "assignee" | "epicId" | "testResults"
>;

/** Active task entry from orchestrator status (v2 multi-slot model) */
export interface ActiveTaskInfo {
  taskId: string;
  phase: string;
  startedAt: string;
}

const TASKS_IN_FLIGHT_KEY = "tasksInFlightCount" as const;

export interface ExecuteState {
  tasks: Task[];
  [TASKS_IN_FLIGHT_KEY]: number;
  orchestratorRunning: boolean;
  awaitingApproval: boolean;
  /** Active tasks being worked on by orchestrator agents (v2 multi-slot) */
  activeTasks: ActiveTaskInfo[];
  selectedTaskId: string | null;
  taskDetail: Task | null;
  taskDetailLoading: boolean;
  /** Error message when task detail fetch fails (kept so we can show it below header) */
  taskDetailError: string | null;
  agentOutput: Record<string, string[]>;
  completionState: {
    status: string;
    testResults: { passed: number; failed: number; skipped: number; total: number } | null;
  } | null;
  archivedSessions: AgentSession[];
  archivedLoading: boolean;
  markDoneLoading: boolean;
  unblockLoading: boolean;
  statusLoading: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: ExecuteState = {
  tasks: [],
  [TASKS_IN_FLIGHT_KEY]: 0,
  orchestratorRunning: false,
  awaitingApproval: false,
  activeTasks: [],
  selectedTaskId: null,
  taskDetail: null,
  taskDetailLoading: false,
  taskDetailError: null,
  agentOutput: {},
  completionState: null,
  archivedSessions: [],
  archivedLoading: false,
  markDoneLoading: false,
  unblockLoading: false,
  statusLoading: false,
  loading: false,
  error: null,
};

export const fetchTasks = createAsyncThunk(
  "execute/fetchTasks",
  async (projectId: string, { getState, rejectWithValue }) => {
    const inFlight = (getState().execute as ExecuteState)[TASKS_IN_FLIGHT_KEY] ?? 0;
    if (inFlight > 1) {
      return rejectWithValue(DEDUP_SKIP);
    }
    return api.tasks.list(projectId);
  }
);

export const fetchExecutePlans = createAsyncThunk(
  "execute/fetchExecutePlans",
  async (projectId: string, { dispatch }) => {
    const graph = await api.plans.list(projectId);
    dispatch(setPlansAndGraph({ plans: graph.plans, dependencyGraph: graph }));
    return graph.plans;
  }
);

export const fetchExecuteStatus = createAsyncThunk(
  "execute/fetchExecuteStatus",
  async (projectId: string) => {
    return api.execute.status(projectId);
  }
);

export const fetchTaskDetail = createAsyncThunk(
  "execute/fetchTaskDetail",
  async ({ projectId, taskId }: { projectId: string; taskId: string }) => {
    return api.tasks.get(projectId, taskId);
  }
);

export const fetchArchivedSessions = createAsyncThunk(
  "execute/fetchArchivedSessions",
  async ({ projectId, taskId }: { projectId: string; taskId: string }) => {
    return (await api.tasks.sessions(projectId, taskId)) ?? [];
  }
);

export const fetchLiveOutputBackfill = createAsyncThunk(
  "execute/fetchLiveOutputBackfill",
  async ({ projectId, taskId }: { projectId: string; taskId: string }) => {
    const output = (await api.execute.liveOutput(projectId, taskId)).output;
    return { taskId, output };
  }
);

export const markTaskDone = createAsyncThunk(
  "execute/markTaskDone",
  async ({ projectId, taskId }: { projectId: string; taskId: string }, { dispatch }) => {
    await api.tasks.markDone(projectId, taskId);
    const [tasksData, plansGraph] = await Promise.all([
      api.tasks.list(projectId),
      api.plans.list(projectId),
    ]);
    dispatch(setPlansAndGraph({ plans: plansGraph.plans, dependencyGraph: plansGraph }));
    return { tasks: tasksData ?? [] };
  }
);

export const updateTaskPriority = createAsyncThunk(
  "execute/updateTaskPriority",
  async (
    {
      projectId,
      taskId,
      priority,
      previousPriority,
    }: { projectId: string; taskId: string; priority: number; previousPriority: number },
    { dispatch, rejectWithValue }
  ) => {
    try {
      const task = await api.tasks.updatePriority(projectId, taskId, priority);
      return { task, taskId };
    } catch (_err) {
      dispatch(setDeliverToast({ message: "Failed to update priority", variant: "failed" }));
      return rejectWithValue({ previousPriority });
    }
  }
);

export const unblockTask = createAsyncThunk(
  "execute/unblockTask",
  async (
    {
      projectId,
      taskId,
      resetAttempts,
    }: { projectId: string; taskId: string; resetAttempts?: boolean },
    { dispatch }
  ) => {
    await api.tasks.unblock(projectId, taskId, { resetAttempts });
    const [tasksData, plansGraph] = await Promise.all([
      api.tasks.list(projectId),
      api.plans.list(projectId),
    ]);
    dispatch(setPlansAndGraph({ plans: plansGraph.plans, dependencyGraph: plansGraph }));
    return { tasks: tasksData ?? [], taskId };
  }
);

const MAX_AGENT_OUTPUT = 5000;

const executeSlice = createSlice({
  name: "execute",
  initialState,
  reducers: {
    setSelectedTaskId(state, action: PayloadAction<string | null>) {
      state.selectedTaskId = action.payload;
      state.completionState = null;
      state.archivedSessions = [];
      state.taskDetail = null;
      state.taskDetailError = null;
    },
    appendAgentOutput(state, action: PayloadAction<{ taskId: string; chunk: string }>) {
      const { taskId, chunk } = action.payload;
      if (chunk) {
        if (!state.agentOutput[taskId]) {
          state.agentOutput[taskId] = [];
        }
        state.agentOutput[taskId].push(chunk);
        if (state.agentOutput[taskId].length > MAX_AGENT_OUTPUT) {
          state.agentOutput[taskId] = state.agentOutput[taskId].slice(-MAX_AGENT_OUTPUT);
        }
      }
      if (taskId === state.selectedTaskId) {
        state.completionState = null;
      }
    },
    setOrchestratorRunning(state, action: PayloadAction<boolean>) {
      state.orchestratorRunning = action.payload;
    },
    setAwaitingApproval(state, action: PayloadAction<boolean>) {
      state.awaitingApproval = action.payload;
    },
    setCompletionState(
      state,
      action: PayloadAction<{
        taskId: string;
        status: string;
        testResults: { passed: number; failed: number; skipped: number; total: number } | null;
      }>
    ) {
      if (action.payload.taskId === state.selectedTaskId) {
        state.completionState = {
          status: action.payload.status,
          testResults: action.payload.testResults,
        };
      }
    },
    taskUpdated(
      state,
      action: PayloadAction<{
        taskId: string;
        status?: string;
        assignee?: string | null;
        priority?: number;
      }>
    ) {
      const { taskId, status, assignee, priority } = action.payload;
      const task = state.tasks.find((t) => t.id === taskId);
      if (task) {
        if (status !== undefined) task.kanbanColumn = mapStatusToKanban(status);
        if (assignee !== undefined) task.assignee = assignee;
        if (priority !== undefined) task.priority = priority;
      }
      if (state.taskDetail?.id === taskId) {
        if (status !== undefined) state.taskDetail.kanbanColumn = mapStatusToKanban(status);
        if (assignee !== undefined) state.taskDetail.assignee = assignee;
        if (priority !== undefined) state.taskDetail.priority = priority;
      }
    },
    setTasks(state, action: PayloadAction<Task[]>) {
      state.tasks = action.payload;
    },
    setExecuteError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
    setActiveTasks(state, action: PayloadAction<ActiveTaskInfo[]>) {
      state.activeTasks = action.payload;
    },
    resetExecute() {
      return initialState;
    },
  },
  extraReducers: (builder) => {
    builder
      // fetchTasks
      .addCase(fetchTasks.pending, (state) => {
        state[TASKS_IN_FLIGHT_KEY] = (state[TASKS_IN_FLIGHT_KEY] ?? 0) + 1;
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTasks.fulfilled, (state, action) => {
        state.tasks = action.payload;
        state.loading = false;
        state[TASKS_IN_FLIGHT_KEY] = Math.max(0, (state[TASKS_IN_FLIGHT_KEY] ?? 1) - 1);
      })
      .addCase(fetchTasks.rejected, (state, action) => {
        state[TASKS_IN_FLIGHT_KEY] = Math.max(0, (state[TASKS_IN_FLIGHT_KEY] ?? 1) - 1);
        if (action.payload === DEDUP_SKIP) return;
        state.loading = false;
        state.error = action.error.message ?? "Failed to load tasks";
      })
      // fetchExecuteStatus
      .addCase(fetchExecuteStatus.pending, (state) => {
        state.statusLoading = true;
        state.error = null;
      })
      .addCase(fetchExecuteStatus.fulfilled, (state, action) => {
        const activeTasks = action.payload.activeTasks ?? [];
        state.activeTasks = activeTasks;
        state.orchestratorRunning = activeTasks.length > 0 || action.payload.queueDepth > 0;
        state.awaitingApproval = action.payload.awaitingApproval ?? false;
        state.statusLoading = false;
      })
      .addCase(fetchExecuteStatus.rejected, (state, action) => {
        state.statusLoading = false;
        state.error = action.error.message ?? "Failed to load execute status";
      })
      // fetchTaskDetail
      .addCase(fetchTaskDetail.pending, (state) => {
        state.taskDetailLoading = true;
        state.taskDetailError = null;
      })
      .addCase(fetchTaskDetail.fulfilled, (state, action) => {
        state.taskDetail = action.payload;
        state.taskDetailLoading = false;
        state.taskDetailError = null;
      })
      .addCase(fetchTaskDetail.rejected, (state, action) => {
        state.taskDetail = null;
        state.taskDetailLoading = false;
        state.taskDetailError = action.error.message ?? "Failed to load task details";
      })
      // fetchArchivedSessions
      .addCase(fetchArchivedSessions.pending, (state) => {
        state.archivedLoading = true;
      })
      .addCase(fetchArchivedSessions.fulfilled, (state, action) => {
        state.archivedSessions = action.payload;
        state.archivedLoading = false;
      })
      .addCase(fetchArchivedSessions.rejected, (state) => {
        state.archivedSessions = [];
        state.archivedLoading = false;
      })
      // fetchLiveOutputBackfill
      .addCase(fetchLiveOutputBackfill.fulfilled, (state, action) => {
        if (action.payload.output) {
          state.agentOutput[action.payload.taskId] = [action.payload.output];
        }
      })
      // markTaskDone
      .addCase(markTaskDone.pending, (state) => {
        state.markDoneLoading = true;
        state.error = null;
      })
      .addCase(markTaskDone.fulfilled, (state, action) => {
        state.tasks = action.payload.tasks;
        state.markDoneLoading = false;
      })
      .addCase(markTaskDone.rejected, (state, action) => {
        state.markDoneLoading = false;
        state.error = action.error.message ?? "Failed to mark done";
      })
      // unblockTask
      .addCase(unblockTask.pending, (state) => {
        state.unblockLoading = true;
        state.error = null;
      })
      .addCase(unblockTask.fulfilled, (state, action) => {
        state.tasks = action.payload.tasks;
        state.taskDetail =
          state.taskDetail?.id === action.payload.taskId
            ? (action.payload.tasks.find((t) => t.id === action.payload.taskId) ?? state.taskDetail)
            : state.taskDetail;
        state.unblockLoading = false;
      })
      .addCase(unblockTask.rejected, (state, action) => {
        state.unblockLoading = false;
        state.error = action.error.message ?? "Failed to unblock";
      })
      // updateTaskPriority — optimistic update, revert on error
      .addCase(updateTaskPriority.pending, (state, action) => {
        const { taskId, priority } = action.meta.arg;
        const task = state.tasks.find((t) => t.id === taskId);
        if (task) task.priority = priority;
        if (state.taskDetail?.id === taskId) state.taskDetail.priority = priority;
      })
      .addCase(updateTaskPriority.fulfilled, (state, action) => {
        const { task } = action.payload;
        if (state.taskDetail?.id === task.id) state.taskDetail = task;
        const t = state.tasks.find((x) => x.id === task.id);
        if (t) t.priority = task.priority;
      })
      .addCase(updateTaskPriority.rejected, (state, action) => {
        const payload = action.payload as { previousPriority: number } | undefined;
        if (!payload) return;
        const { taskId } = action.meta.arg;
        const previousPriority = payload.previousPriority;
        const task = state.tasks.find((t) => t.id === taskId);
        if (task) task.priority = previousPriority;
        if (state.taskDetail?.id === taskId) state.taskDetail.priority = previousPriority;
      });
  },
});

export const {
  setSelectedTaskId,
  appendAgentOutput,
  setOrchestratorRunning,
  setAwaitingApproval,
  setActiveTasks,
  setCompletionState,
  taskUpdated,
  setTasks,
  setExecuteError,
  resetExecute,
} = executeSlice.actions;
export default executeSlice.reducer;
