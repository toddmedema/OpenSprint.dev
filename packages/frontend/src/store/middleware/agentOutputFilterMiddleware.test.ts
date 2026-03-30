import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { agentOutputFilterMiddleware } from "./agentOutputFilterMiddleware";
import executeReducer, {
  appendAgentOutput,
  setAgentOutputBackfill,
  setSelectedTaskId,
} from "../slices/executeSlice";
import planReducer from "../slices/planSlice";
import websocketReducer from "../slices/websocketSlice";

describe("agentOutputFilterMiddleware", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  function createStore() {
    return configureStore({
      reducer: { execute: executeReducer, plan: planReducer, websocket: websocketReducer },
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware().concat(agentOutputFilterMiddleware),
    });
  }

  it("batches multiple appendAgentOutput actions within window", () => {
    vi.useFakeTimers();
    const store = createStore();
    store.dispatch(setSelectedTaskId("task-1"));

    store.dispatch(appendAgentOutput({ taskId: "task-1", chunk: '{"type":"text","text":"a"}\n' }));
    store.dispatch(appendAgentOutput({ taskId: "task-1", chunk: '{"type":"text","text":"b"}\n' }));
    store.dispatch(appendAgentOutput({ taskId: "task-1", chunk: '{"type":"text","text":"c"}\n' }));

    expect(store.getState().execute.agentOutput["task-1"]).toBeUndefined();

    vi.advanceTimersByTime(200);

    expect(store.getState().execute.agentOutput["task-1"]).toEqual(["abc"]);
    vi.useRealTimers();
  });

  it("flushes on setSelectedTaskId without waiting for batch window", () => {
    const store = createStore();
    store.dispatch(setSelectedTaskId("task-1"));

    store.dispatch(appendAgentOutput({ taskId: "task-1", chunk: '{"type":"text","text":"x"}\n' }));
    store.dispatch(appendAgentOutput({ taskId: "task-1", chunk: '{"type":"text","text":"y"}\n' }));

    store.dispatch(setSelectedTaskId("task-2"));

    expect(store.getState().execute.agentOutput["task-1"]).toEqual(["xy"]);
  });

  it("does not lose content when flushing on setSelectedTaskId (switch tasks)", () => {
    const store = createStore();
    store.dispatch(setSelectedTaskId("task-1"));

    store.dispatch(appendAgentOutput({ taskId: "task-1", chunk: "first\n" }));
    store.dispatch(setSelectedTaskId("task-2"));
    expect(store.getState().execute.agentOutput["task-1"]).toEqual(["first\n"]);

    store.dispatch(setSelectedTaskId("task-1"));
    store.dispatch(appendAgentOutput({ taskId: "task-1", chunk: "second\n" }));
    store.dispatch(setSelectedTaskId(null));
    // Closing sidebar clears agentOutput for previous task to free memory
    expect(store.getState().execute.agentOutput["task-1"]).toBeUndefined();
  });

  it("discards buffered chunks when setAgentOutputBackfill arrives (prevents duplicate trailing text)", () => {
    vi.useFakeTimers();
    const store = createStore();
    store.dispatch(setSelectedTaskId("task-1"));

    // NDJSON chunks go through the filter and land in the middleware batch buffer
    store.dispatch(
      appendAgentOutput({ taskId: "task-1", chunk: '{"type":"text","text":"hello "}\n' })
    );
    store.dispatch(
      appendAgentOutput({ taskId: "task-1", chunk: '{"type":"text","text":"world"}\n' })
    );

    // Chunks are still in the middleware buffer, not yet in the store
    expect(store.getState().execute.agentOutput["task-1"]).toBeUndefined();

    // Backfill arrives (includes everything up to and including the buffered chunks).
    // filterAgentOutput processes full NDJSON, so use the same format.
    store.dispatch(
      setAgentOutputBackfill({
        taskId: "task-1",
        output: '{"type":"text","text":"hello "}\n{"type":"text","text":"world"}\n',
      })
    );
    expect(store.getState().execute.agentOutput["task-1"]).toEqual(["hello world"]);

    // Advance past the batch window — stale buffer must NOT flush
    vi.advanceTimersByTime(500);
    expect(store.getState().execute.agentOutput["task-1"]).toEqual(["hello world"]);
    vi.useRealTimers();
  });

  it("keeps buffer for other tasks when backfill clears one task", () => {
    vi.useFakeTimers();
    const store = createStore();
    store.dispatch(setSelectedTaskId("task-1"));

    store.dispatch(appendAgentOutput({ taskId: "task-1", chunk: '{"type":"text","text":"a1"}\n' }));
    store.dispatch(appendAgentOutput({ taskId: "task-2", chunk: '{"type":"text","text":"b1"}\n' }));

    // Backfill only task-1 — task-2 buffer should be preserved
    store.dispatch(
      setAgentOutputBackfill({
        taskId: "task-1",
        output: '{"type":"text","text":"a1 full"}\n',
      })
    );

    vi.advanceTimersByTime(500);

    expect(store.getState().execute.agentOutput["task-1"]).toEqual(["a1 full"]);
    expect(store.getState().execute.agentOutput["task-2"]).toEqual(["b1"]);
    vi.useRealTimers();
  });

  it("accepts new chunks after backfill without duplication", () => {
    vi.useFakeTimers();
    const store = createStore();
    store.dispatch(setSelectedTaskId("task-1"));

    store.dispatch(
      appendAgentOutput({ taskId: "task-1", chunk: '{"type":"text","text":"old"}\n' })
    );
    store.dispatch(
      setAgentOutputBackfill({
        taskId: "task-1",
        output: '{"type":"text","text":"old content"}\n',
      })
    );

    // New chunk arrives after backfill
    store.dispatch(
      appendAgentOutput({ taskId: "task-1", chunk: '{"type":"text","text":" plus new"}\n' })
    );
    vi.advanceTimersByTime(500);

    expect(store.getState().execute.agentOutput["task-1"]).toEqual(["old content", " plus new"]);
    vi.useRealTimers();
  });
});
