import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import designReducer, {
  addUserMessage,
  setDesignError,
  resetDesign,
  fetchDesignChat,
  sendDesignMessage,
  type DesignState,
} from "./designSlice";

vi.mock("../../api/client", () => ({
  api: {
    chat: {
      history: vi.fn(),
      send: vi.fn(),
    },
    prd: {
      get: vi.fn(),
      getHistory: vi.fn(),
      updateSection: vi.fn(),
      upload: vi.fn(),
    },
  },
}));

import { api } from "../../api/client";

const mockMessage = {
  role: "user" as const,
  content: "Hello",
  timestamp: "2025-01-01T00:00:00Z",
};

describe("designSlice", () => {
  beforeEach(() => {
    vi.mocked(api.chat.history).mockReset();
    vi.mocked(api.chat.send).mockReset();
    vi.mocked(api.prd.get).mockReset();
    vi.mocked(api.prd.getHistory).mockReset();
    vi.mocked(api.prd.updateSection).mockReset();
    vi.mocked(api.prd.upload).mockReset();
  });

  function createStore() {
    return configureStore({ reducer: { design: designReducer } });
  }

  describe("initial state", () => {
    it("has correct initial state", () => {
      const store = createStore();
      const state = store.getState().design as DesignState;
      expect(state.messages).toEqual([]);
      expect(state.prdContent).toEqual({});
      expect(state.prdHistory).toEqual([]);
      expect(state.sendingChat).toBe(false);
      expect(state.savingSections).toEqual([]);
      expect(state.error).toBeNull();
    });
  });

  describe("reducers", () => {
    it("addUserMessage appends message", () => {
      const store = createStore();
      store.dispatch(addUserMessage(mockMessage));
      expect(store.getState().design.messages).toHaveLength(1);
      expect(store.getState().design.messages[0]).toEqual(mockMessage);
    });

    it("setDesignError sets error", () => {
      const store = createStore();
      store.dispatch(setDesignError("Something went wrong"));
      expect(store.getState().design.error).toBe("Something went wrong");
      store.dispatch(setDesignError(null));
      expect(store.getState().design.error).toBeNull();
    });

    it("resetDesign resets to initial state", () => {
      const store = createStore();
      store.dispatch(addUserMessage(mockMessage));
      store.dispatch(setDesignError("error"));
      store.dispatch(resetDesign());
      const state = store.getState().design as DesignState;
      expect(state.messages).toEqual([]);
      expect(state.error).toBeNull();
    });
  });

  describe("fetchDesignChat thunk", () => {
    it("stores messages on fulfilled and uses design context", async () => {
      const messages = [
        { role: "user" as const, content: "hi", timestamp: "2025-01-01" },
        { role: "assistant" as const, content: "hello", timestamp: "2025-01-01" },
      ];
      vi.mocked(api.chat.history).mockResolvedValue({ messages } as never);
      const store = createStore();
      await store.dispatch(fetchDesignChat("proj-1"));

      expect(store.getState().design.messages).toEqual(messages);
      expect(api.chat.history).toHaveBeenCalledWith("proj-1", "design");
    });
  });

  describe("sendDesignMessage thunk", () => {
    it("uses design context for api.chat.send", async () => {
      vi.mocked(api.chat.send).mockResolvedValue({ message: "Response" } as never);
      const store = createStore();
      await store.dispatch(sendDesignMessage({ projectId: "proj-1", message: "hello" }));

      expect(api.chat.send).toHaveBeenCalledWith("proj-1", "hello", "design", undefined);
    });
  });
});
