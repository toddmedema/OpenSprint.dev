import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface WebsocketState {
  connected: boolean;
}

const initialState: WebsocketState = {
  connected: false,
};

const websocketSlice = createSlice({
  name: "websocket",
  initialState,
  reducers: {
    setConnected(state, action: PayloadAction<boolean>) {
      state.connected = action.payload;
    },
    resetWebsocket() {
      return initialState;
    },
  },
});

export const { setConnected, resetWebsocket } = websocketSlice.actions;
export default websocketSlice.reducer;
