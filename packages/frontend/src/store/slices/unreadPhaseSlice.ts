import { createSlice, createSelector, type PayloadAction } from "@reduxjs/toolkit";

export type UnreadPhase = "plan" | "sketch" | "execute";

export interface UnreadPhaseFlags {
  plan?: boolean;
  sketch?: boolean;
  execute?: boolean;
}

export type UnreadPhaseState = Record<string, UnreadPhaseFlags>;

export interface SetPhaseUnreadPayload {
  projectId: string;
  phase: UnreadPhase;
}

export interface ClearPhaseUnreadPayload {
  projectId: string;
  phase: UnreadPhase;
}

const initialState: UnreadPhaseState = {};

export const unreadPhaseSlice = createSlice({
  name: "unreadPhase",
  initialState,
  reducers: {
    setPhaseUnread(state, action: PayloadAction<SetPhaseUnreadPayload>) {
      const { projectId, phase } = action.payload;
      if (!state[projectId]) {
        state[projectId] = {};
      }
      state[projectId][phase] = true;
    },
    clearPhaseUnread(state, action: PayloadAction<ClearPhaseUnreadPayload>) {
      const { projectId, phase } = action.payload;
      if (state[projectId]) {
        delete state[projectId][phase];
        if (Object.keys(state[projectId]).length === 0) {
          delete state[projectId];
        }
      }
    },
  },
});

export const { setPhaseUnread, clearPhaseUnread } = unreadPhaseSlice.actions;
export default unreadPhaseSlice.reducer;

/** Root state shape for the unreadPhase slice (for selector typing). */
export type UnreadPhaseRootState = { unreadPhase: UnreadPhaseState };

/** Stable empty flags object for use when there is no project (e.g. Navbar). */
export const EMPTY_PHASE_UNREAD: UnreadPhaseFlags = {
  plan: false,
  sketch: false,
  execute: false,
};

const selectUnreadPhaseByProject = (state: UnreadPhaseRootState, projectId: string) =>
  state.unreadPhase?.[projectId];

/**
 * Returns unread flags for a project: { plan, sketch, execute }.
 * Memoized so the same reference is returned when inputs are unchanged (avoids unnecessary rerenders).
 */
export const selectPhaseUnread = createSelector(
  [selectUnreadPhaseByProject],
  (flags): UnreadPhaseFlags =>
    flags == null || (flags.plan !== true && flags.sketch !== true && flags.execute !== true)
      ? EMPTY_PHASE_UNREAD
      : {
          plan: flags.plan ?? false,
          sketch: flags.sketch ?? false,
          execute: flags.execute ?? false,
        }
);
