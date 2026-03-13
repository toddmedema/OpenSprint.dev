import type { PayloadAction } from "@reduxjs/toolkit";
import type { ActionReducerMapBuilder } from "@reduxjs/toolkit";
import type { ActiveAgent } from "@opensprint/shared";
import type { ExecuteState } from "./executeTypes";
import { fetchActiveAgents } from "./executeThunks";
import { ensureAsync } from "./executeThunks";
import { createAsyncHandlers } from "../asyncHelpers";

export const activeAgentsReducers = {
  /** Sync from TanStack Query useActiveAgents (agents + taskIdToStartedAt). */
  setActiveAgentsPayload(
    state: ExecuteState,
    action: PayloadAction<{
      agents: ActiveAgent[];
      taskIdToStartedAt: Record<string, string>;
    }>
  ) {
    state.activeAgents = action.payload.agents;
    state.activeAgentsLoadedOnce = true;
    state.taskIdToStartedAt = action.payload.taskIdToStartedAt ?? {};
  },
};

export function addActiveAgentsExtraReducers(builder: ActionReducerMapBuilder<ExecuteState>): void {
  createAsyncHandlers("activeAgents", fetchActiveAgents, builder, {
    ensureState: ensureAsync,
    onFulfilled: (state, action) => {
      const { agents, taskIdToStartedAt } = action.payload as {
        agents: ActiveAgent[];
        taskIdToStartedAt: Record<string, string>;
      };
      state.activeAgents = agents ?? [];
      state.activeAgentsLoadedOnce = true;
      state.taskIdToStartedAt = taskIdToStartedAt ?? {};
    },
    onRejected: (state) => {
      state.activeAgents = [];
      state.activeAgentsLoadedOnce = true;
      state.taskIdToStartedAt = {};
    },
  });
}
