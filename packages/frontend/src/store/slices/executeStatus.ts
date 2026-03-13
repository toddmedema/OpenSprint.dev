import type { PayloadAction } from "@reduxjs/toolkit";
import type { ActionReducerMapBuilder } from "@reduxjs/toolkit";
import type { ExecuteState } from "./executeTypes";
import type { ActiveTaskInfo } from "./executeTypes";
import { fetchExecuteStatus } from "./executeThunks";
import { ensureAsync } from "./executeThunks";
import { createAsyncHandlers } from "../asyncHelpers";

export const statusReducers = {
  setOrchestratorRunning(state: ExecuteState, action: PayloadAction<boolean>) {
    state.orchestratorRunning = action.payload;
  },
  setAwaitingApproval(state: ExecuteState, action: PayloadAction<boolean>) {
    state.awaitingApproval = action.payload;
  },
  setActiveTasks(state: ExecuteState, action: PayloadAction<ActiveTaskInfo[]>) {
    state.activeTasks = action.payload;
  },
  /** Sync from TanStack Query useExecuteStatus (replaces fetchExecuteStatus.fulfilled). */
  setExecuteStatusPayload(
    state: ExecuteState,
    action: PayloadAction<{
      activeTasks?: ActiveTaskInfo[];
      queueDepth?: number;
      awaitingApproval?: boolean;
      totalDone?: number;
      totalFailed?: number;
      selfImprovementRunInProgress?: boolean;
    }>
  ) {
    const p = action.payload;
    const activeTasks = p.activeTasks ?? [];
    state.activeTasks = activeTasks;
    state.orchestratorRunning = activeTasks.length > 0 || (p.queueDepth ?? 0) > 0;
    state.awaitingApproval = p.awaitingApproval ?? false;
    state.totalDone = p.totalDone ?? 0;
    state.totalFailed = p.totalFailed ?? 0;
    state.queueDepth = p.queueDepth ?? 0;
    if (p.selfImprovementRunInProgress !== undefined) {
      state.selfImprovementRunInProgress = p.selfImprovementRunInProgress;
    }
  },
  setSelfImprovementRunInProgress(state: ExecuteState, action: PayloadAction<boolean>) {
    state.selfImprovementRunInProgress = action.payload;
  },
};

export function addStatusExtraReducers(builder: ActionReducerMapBuilder<ExecuteState>): void {
  createAsyncHandlers("status", fetchExecuteStatus, builder, {
    ensureState: ensureAsync,
    onPending: (state) => {
      state.error = null;
    },
    onFulfilled: (state, action) => {
      const payload = action.payload as {
        activeTasks?: ActiveTaskInfo[];
        queueDepth?: number;
        awaitingApproval?: boolean;
        totalDone?: number;
        totalFailed?: number;
        selfImprovementRunInProgress?: boolean;
      };
      const activeTasks = payload.activeTasks ?? [];
      state.activeTasks = activeTasks;
      state.orchestratorRunning = activeTasks.length > 0 || (payload.queueDepth ?? 0) > 0;
      state.awaitingApproval = payload.awaitingApproval ?? false;
      state.totalDone = payload.totalDone ?? 0;
      state.totalFailed = payload.totalFailed ?? 0;
      state.queueDepth = payload.queueDepth ?? 0;
      if (payload.selfImprovementRunInProgress !== undefined) {
        state.selfImprovementRunInProgress = payload.selfImprovementRunInProgress;
      }
    },
    onRejected: (state, action) => {
      state.error = action.error?.message ?? "Failed to load execute status";
    },
    defaultError: "Failed to load execute status",
  });
}
