import { describe, it, expect } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import websocketReducer, {
  setConnected,
  resetWebsocket,
  type WebsocketState,
} from "./websocketSlice";

describe("websocketSlice", () => {
  describe("initial state", () => {
    it("has correct initial state", () => {
      const store = configureStore({ reducer: { websocket: websocketReducer } });
      const state = store.getState().websocket as WebsocketState;
      expect(state.connected).toBe(false);
    });
  });

  describe("setConnected", () => {
    it("sets connected to true", () => {
      const store = configureStore({ reducer: { websocket: websocketReducer } });
      store.dispatch(setConnected(true));
      expect(store.getState().websocket.connected).toBe(true);
    });

    it("sets connected to false", () => {
      const store = configureStore({ reducer: { websocket: websocketReducer } });
      store.dispatch(setConnected(true));
      store.dispatch(setConnected(false));
      expect(store.getState().websocket.connected).toBe(false);
    });
  });

  describe("resetWebsocket", () => {
    it("resets all state to initial values", () => {
      const store = configureStore({ reducer: { websocket: websocketReducer } });
      store.dispatch(setConnected(true));

      store.dispatch(resetWebsocket());

      const state = store.getState().websocket as WebsocketState;
      expect(state.connected).toBe(false);
    });
  });
});
