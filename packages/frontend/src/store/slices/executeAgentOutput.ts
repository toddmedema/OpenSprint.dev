import type { PayloadAction } from "@reduxjs/toolkit";
import type { ActionReducerMapBuilder } from "@reduxjs/toolkit";
import type { AgentSession } from "@opensprint/shared";
import type { ExecuteState } from "./executeTypes";
import { MAX_AGENT_OUTPUT } from "./executeTypes";
import { fetchArchivedSessions, fetchLiveOutputBackfill, ensureAsync } from "./executeThunks";
import { filterAgentOutput } from "../../utils/agentOutputFilter";
import { createAsyncHandlers } from "../asyncHelpers";

export const agentOutputReducers = {
  setSelectedTaskId(state: ExecuteState, action: PayloadAction<string | null>) {
    ensureAsync(state);
    if (!state.agentOutput) state.agentOutput = {};
    const next = action.payload;
    const prev = state.selectedTaskId;
    const changed = prev !== next;
    state.selectedTaskId = next;
    state.archivedSessions = [];
    if (changed) state.async.taskDetail.error = null;
    if (next === null && prev && state.agentOutput[prev]) {
      delete state.agentOutput[prev];
    }
  },
  appendAgentOutput(state: ExecuteState, action: PayloadAction<{ taskId: string; chunk: string }>) {
    if (!state.agentOutput) state.agentOutput = {};
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
      delete state.completionStateByTaskId[taskId];
    }
  },
  /** Replace agent output for a task (e.g. backfill on subscribe). */
  setAgentOutputBackfill(
    state: ExecuteState,
    action: PayloadAction<{ taskId: string; output: string }>
  ) {
    if (!state.agentOutput) state.agentOutput = {};
    const { taskId, output } = action.payload;
    if (output.length > 0) {
      state.agentOutput[taskId] = [output];
    }
  },
  setCompletionState(
    state: ExecuteState,
    action: PayloadAction<{
      taskId: string;
      status: string;
      testResults: { passed: number; failed: number; skipped: number; total: number } | null;
      reason?: string | null;
    }>
  ) {
    if (!state.completionStateByTaskId) state.completionStateByTaskId = {};
    state.completionStateByTaskId[action.payload.taskId] = {
      status: action.payload.status,
      testResults: action.payload.testResults,
      reason: action.payload.reason ?? null,
    };
  },
  /** Sync from TanStack Query useArchivedSessions. */
  setArchivedSessions(state: ExecuteState, action: PayloadAction<AgentSession[]>) {
    state.archivedSessions = action.payload;
  },
};

export function addAgentOutputExtraReducers(builder: ActionReducerMapBuilder<ExecuteState>): void {
  createAsyncHandlers("archived", fetchArchivedSessions, builder, {
    ensureState: ensureAsync,
    onFulfilled: (state, action) => {
      state.archivedSessions = action.payload as AgentSession[];
    },
    onRejected: (state) => {
      state.archivedSessions = [];
    },
  });

  builder.addCase(fetchLiveOutputBackfill.fulfilled, (state, action) => {
    if (!state.agentOutput) state.agentOutput = {};
    const filtered = filterAgentOutput(action.payload.output ?? "");
    state.agentOutput[action.payload.taskId] = [filtered];
  });
}
