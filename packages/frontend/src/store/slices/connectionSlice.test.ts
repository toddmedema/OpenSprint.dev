import { describe, it, expect } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import connectionReducer, { setConnectionError } from "./connectionSlice";

function createStore(preloadedState?: {
  connection?: { connectionError: boolean; lastRecoveredAt?: number | null };
}) {
  return configureStore({
    reducer: { connection: connectionReducer },
    preloadedState,
  });
}

describe("connectionSlice", () => {
  it("initial state has connectionError false", () => {
    const store = createStore();
    expect(store.getState().connection.connectionError).toBe(false);
  });

  it("setConnectionError(true) sets connectionError", () => {
    const store = createStore();
    store.dispatch(setConnectionError(true));
    expect(store.getState().connection.connectionError).toBe(true);
  });

  it("setConnectionError(false) clears connectionError and sets lastRecoveredAt", () => {
    const store = createStore({ connection: { connectionError: true } });
    const before = Date.now();
    store.dispatch(setConnectionError(false));
    const state = store.getState().connection;
    expect(state.connectionError).toBe(false);
    expect(state.lastRecoveredAt).toBeGreaterThanOrEqual(before);
  });

  it("initial state has lastRecoveredAt null", () => {
    const store = createStore();
    expect(store.getState().connection.lastRecoveredAt).toBeNull();
  });
});
