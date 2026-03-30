import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import {
  initialExecuteState,
  type ExecuteState,
  type ExecuteRootState,
  type ActiveTaskInfo,
  type TaskCard,
} from "./executeTypes";
import { taskListReducers, addTaskListExtraReducers } from "./executeTaskList";
import { statusReducers, addStatusExtraReducers } from "./executeStatus";
import { activeAgentsReducers, addActiveAgentsExtraReducers } from "./executeActiveAgents";
import { agentOutputReducers, addAgentOutputExtraReducers } from "./executeAgentOutput";

const executeSlice = createSlice({
  name: "execute",
  initialState: initialExecuteState,
  reducers: {
    ...taskListReducers,
    ...statusReducers,
    ...activeAgentsReducers,
    ...agentOutputReducers,
    setExecuteError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
    resetExecute() {
      return initialExecuteState;
    },
  },
  extraReducers: (builder) => {
    addTaskListExtraReducers(builder);
    addStatusExtraReducers(builder);
    addActiveAgentsExtraReducers(builder);
    addAgentOutputExtraReducers(builder);
  },
});

export const {
  setSelectedTaskId,
  appendAgentOutput,
  setAgentOutputBackfill,
  setOrchestratorRunning,
  setAwaitingApproval,
  setActiveTasks,
  setCompletionState,
  taskUpdated,
  taskCreated,
  taskClosed,
  setTasks,
  setExecuteError,
  setExecuteStatusPayload,
  sweepExpiredBaselineMergePauseTick,
  setSelfImprovementRunInProgress,
  setArchivedSessions,
  setActiveAgentsPayload,
  resetExecute,
} = executeSlice.actions;

// Re-export types and initial state
export type { ExecuteState, ExecuteRootState, ActiveTaskInfo, TaskCard };
export { initialExecuteState, MAX_AGENT_OUTPUT } from "./executeTypes";

// Re-export thunks and helpers
export {
  fetchTasks,
  fetchTasksByIds,
  fetchExecutePlans,
  fetchExecuteStatus,
  fetchActiveAgents,
  fetchTaskDetail,
  fetchArchivedSessions,
  fetchLiveOutputBackfill,
  markTaskDone,
  updateTaskPriority,
  updateTaskAssignee,
  addTaskDependency,
  removeTaskDependency,
  unblockTask,
  toTasksByIdAndOrder,
} from "./executeThunks";
export type { FetchTasksArg } from "./executeThunks";

// Re-export selectors
export {
  selectTasks,
  selectTaskSummaries,
  selectSelectedTaskOutput,
  selectAgentOutputLastReceivedAt,
  selectCompletionState,
  selectTaskSummariesForFeedback,
  selectTaskById,
  selectTaskTitle,
  selectTaskSummary,
  selectTasksForEpic,
  selectTasksLoading,
  selectTaskDetailLoading,
  selectTaskDetailError,
  selectArchivedLoading,
  selectMarkDoneLoading,
  selectUnblockLoading,
  selectPriorityUpdatePendingTaskId,
} from "./executeSelectors";

export default executeSlice.reducer;
