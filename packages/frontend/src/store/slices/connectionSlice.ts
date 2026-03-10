import { createSlice } from "@reduxjs/toolkit";

export interface ConnectionState {
  /** True when fetch/WebSocket failed due to network/server unreachable. */
  connectionError: boolean;
  /** Timestamp when connection was last restored; used to debounce re-show on flicker. */
  lastRecoveredAt: number | null;
}

const initialState: ConnectionState = {
  connectionError: false,
  lastRecoveredAt: null,
};

export const connectionSlice = createSlice({
  name: "connection",
  initialState,
  reducers: {
    setConnectionError(state, action: { payload: boolean }) {
      state.connectionError = action.payload;
      if (action.payload === false) {
        state.lastRecoveredAt = Date.now();
      }
    },
  },
});

export const { setConnectionError } = connectionSlice.actions;
export default connectionSlice.reducer;
