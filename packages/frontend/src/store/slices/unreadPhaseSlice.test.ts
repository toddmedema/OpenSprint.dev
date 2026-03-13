import { describe, it, expect } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import unreadPhaseReducer, {
  setPhaseUnread,
  clearPhaseUnread,
  selectPhaseUnread,
} from "./unreadPhaseSlice";

function createStore(preloadedState?: {
  unreadPhase?: Record<string, { plan?: boolean; sketch?: boolean; execute?: boolean }>;
}) {
  return configureStore({
    reducer: { unreadPhase: unreadPhaseReducer },
    preloadedState,
  });
}

describe("unreadPhaseSlice", () => {
  describe("reducers", () => {
    it("initial state is empty", () => {
      const store = createStore();
      expect(store.getState().unreadPhase).toEqual({});
    });

    it("setPhaseUnread sets the flag for that project/phase", () => {
      const store = createStore();
      store.dispatch(setPhaseUnread({ projectId: "proj-1", phase: "plan" }));
      expect(store.getState().unreadPhase).toEqual({
        "proj-1": { plan: true },
      });
    });

    it("setPhaseUnread can set multiple phases for same project", () => {
      const store = createStore();
      store.dispatch(setPhaseUnread({ projectId: "proj-1", phase: "plan" }));
      store.dispatch(setPhaseUnread({ projectId: "proj-1", phase: "sketch" }));
      store.dispatch(setPhaseUnread({ projectId: "proj-1", phase: "execute" }));
      expect(store.getState().unreadPhase).toEqual({
        "proj-1": { plan: true, sketch: true, execute: true },
      });
    });

    it("clearPhaseUnread clears the flag for that project/phase", () => {
      const store = createStore({
        unreadPhase: { "proj-1": { plan: true, sketch: true } },
      });
      store.dispatch(clearPhaseUnread({ projectId: "proj-1", phase: "plan" }));
      expect(store.getState().unreadPhase).toEqual({
        "proj-1": { sketch: true },
      });
    });

    it("clearPhaseUnread removes project entry when last phase cleared", () => {
      const store = createStore({
        unreadPhase: { "proj-1": { plan: true } },
      });
      store.dispatch(clearPhaseUnread({ projectId: "proj-1", phase: "plan" }));
      expect(store.getState().unreadPhase).toEqual({});
    });

    it("clearPhaseUnread is no-op when project or phase not set", () => {
      const store = createStore({
        unreadPhase: { "proj-1": { sketch: true } },
      });
      store.dispatch(clearPhaseUnread({ projectId: "proj-1", phase: "plan" }));
      store.dispatch(clearPhaseUnread({ projectId: "proj-2", phase: "sketch" }));
      expect(store.getState().unreadPhase).toEqual({
        "proj-1": { sketch: true },
      });
    });

    it("multiple projects have independent flags", () => {
      const store = createStore();
      store.dispatch(setPhaseUnread({ projectId: "proj-a", phase: "plan" }));
      store.dispatch(setPhaseUnread({ projectId: "proj-b", phase: "sketch" }));
      store.dispatch(setPhaseUnread({ projectId: "proj-a", phase: "execute" }));
      expect(store.getState().unreadPhase).toEqual({
        "proj-a": { plan: true, execute: true },
        "proj-b": { sketch: true },
      });
      store.dispatch(clearPhaseUnread({ projectId: "proj-a", phase: "plan" }));
      expect(store.getState().unreadPhase).toEqual({
        "proj-a": { execute: true },
        "proj-b": { sketch: true },
      });
    });
  });

  describe("selectPhaseUnread", () => {
    it("returns all false for unknown project", () => {
      const store = createStore();
      const result = selectPhaseUnread(store.getState(), "unknown");
      expect(result).toEqual({ plan: false, sketch: false, execute: false });
    });

    it("returns flags for existing project", () => {
      const store = createStore({
        unreadPhase: { "proj-1": { plan: true, execute: true } },
      });
      const result = selectPhaseUnread(store.getState(), "proj-1");
      expect(result).toEqual({ plan: true, sketch: false, execute: true });
    });

    it("returns all false for project with no flags after clear", () => {
      const store = createStore({
        unreadPhase: { "proj-1": { plan: true } },
      });
      store.dispatch(clearPhaseUnread({ projectId: "proj-1", phase: "plan" }));
      const result = selectPhaseUnread(store.getState(), "proj-1");
      expect(result).toEqual({ plan: false, sketch: false, execute: false });
    });

    it("returns stable reference when inputs unchanged (memoization)", () => {
      const store = createStore({
        unreadPhase: { "proj-1": { plan: true } },
      });
      const state = store.getState();
      const a = selectPhaseUnread(state, "unknown");
      const b = selectPhaseUnread(state, "unknown");
      expect(a).toBe(b);
      const c = selectPhaseUnread(state, "proj-1");
      const d = selectPhaseUnread(state, "proj-1");
      expect(c).toBe(d);
    });
  });
});
