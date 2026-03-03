import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { renderHook, act } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import websocketReducer, { setConnected } from "../store/slices/websocketSlice";
import { useIsOffline } from "./useIsOffline";

function createStore(connected: boolean) {
  return configureStore({
    reducer: { websocket: websocketReducer },
    preloadedState: {
      websocket: { connected, deliverToast: null },
    },
  });
}

describe("useIsOffline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false when websocket is connected", () => {
    const store = createStore(true);
    const { result } = renderHook(() => useIsOffline(), {
      wrapper: ({ children }) => createElement(Provider, { store }, children),
    });
    expect(result.current).toBe(false);
  });

  it("returns false initially when disconnected (debounce not yet fired)", () => {
    const store = createStore(false);
    const { result } = renderHook(() => useIsOffline(), {
      wrapper: ({ children }) => createElement(Provider, { store }, children),
    });
    expect(result.current).toBe(false);
  });

  it("returns true after 600ms when disconnected", async () => {
    const store = createStore(false);
    const { result } = renderHook(() => useIsOffline(), {
      wrapper: ({ children }) => createElement(Provider, { store }, children),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(result.current).toBe(true);
  });

  it("returns false again when reconnected", async () => {
    const store = createStore(false);
    const { result } = renderHook(() => useIsOffline(), {
      wrapper: ({ children }) => createElement(Provider, { store }, children),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(result.current).toBe(true);

    store.dispatch(setConnected(true));
    await act(async () => {});
    expect(result.current).toBe(false);
  });
});
