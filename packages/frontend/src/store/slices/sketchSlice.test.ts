import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import sketchReducer, {
  addUserMessage,
  setSketchError,
  setPrdContent,
  setPrdHistory,
  resetSketch,
  fetchSketchChat,
  fetchPrd,
  fetchPrdHistory,
  sendSketchMessage,
  savePrdSection,
  uploadPrdFile,
  type SketchState,
} from "./sketchSlice";

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

describe("sketchSlice", () => {
  beforeEach(() => {
    vi.mocked(api.chat.history).mockReset();
    vi.mocked(api.chat.send).mockReset();
    vi.mocked(api.prd.get).mockReset();
    vi.mocked(api.prd.getHistory).mockReset();
    vi.mocked(api.prd.updateSection).mockReset();
    vi.mocked(api.prd.upload).mockReset();
  });

  function createStore() {
    return configureStore({ reducer: { sketch: sketchReducer } });
  }

  describe("initial state", () => {
    it("has correct initial state", () => {
      const store = createStore();
      const state = store.getState().sketch as SketchState;
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
      expect(store.getState().sketch.messages).toHaveLength(1);
      expect(store.getState().sketch.messages[0]).toEqual(mockMessage);
    });

    it("setSketchError sets error", () => {
      const store = createStore();
      store.dispatch(setSketchError("Something went wrong"));
      expect(store.getState().sketch.error).toBe("Something went wrong");
      store.dispatch(setSketchError(null));
      expect(store.getState().sketch.error).toBeNull();
    });

    it("setPrdContent sets PRD content", () => {
      const store = createStore();
      const content = { overview: "Overview text", goals: "Goals text" };
      store.dispatch(setPrdContent(content));
      expect(store.getState().sketch.prdContent).toEqual(content);
    });

    it("setPrdHistory sets PRD history", () => {
      const store = createStore();
      const history = [
        {
          section: "executive_summary" as const,
          version: 1,
          source: "sketch" as const,
          timestamp: "2025-01-01",
          diff: "old",
        },
      ];
      store.dispatch(setPrdHistory(history as never));
      expect(store.getState().sketch.prdHistory).toEqual(history);
    });

    it("resetSketch resets to initial state", () => {
      const store = createStore();
      store.dispatch(addUserMessage(mockMessage));
      store.dispatch(setSketchError("error"));
      store.dispatch(setPrdContent({ overview: "x" }));

      store.dispatch(resetSketch());
      const state = store.getState().sketch as SketchState;
      expect(state.messages).toEqual([]);
      expect(state.prdContent).toEqual({});
      expect(state.error).toBeNull();
    });
  });

  describe("fetchSketchChat thunk", () => {
    it("stores messages on fulfilled", async () => {
      const messages = [
        { role: "user" as const, content: "hi", timestamp: "2025-01-01" },
        { role: "assistant" as const, content: "hello", timestamp: "2025-01-01" },
      ];
      vi.mocked(api.chat.history).mockResolvedValue({ messages } as never);
      const store = createStore();
      await store.dispatch(fetchSketchChat("proj-1"));

      expect(store.getState().sketch.messages).toEqual(messages);
      expect(api.chat.history).toHaveBeenCalledWith("proj-1", "sketch");
    });

    it("uses empty array when messages missing", async () => {
      vi.mocked(api.chat.history).mockResolvedValue({} as never);
      const store = createStore();
      await store.dispatch(fetchSketchChat("proj-1"));

      expect(store.getState().sketch.messages).toEqual([]);
    });

    it("messages persist: fetchSketchChat after send returns server state", async () => {
      vi.mocked(api.chat.send).mockResolvedValue({ message: "Assistant reply" } as never);
      const store = createStore();
      store.dispatch(addUserMessage({ role: "user", content: "hello", timestamp: "2025-01-01" }));
      await store.dispatch(sendSketchMessage({ projectId: "proj-1", message: "hello" }));

      const persistedMessages = [
        { role: "user" as const, content: "hello", timestamp: "2025-01-01T00:00:00Z" },
        {
          role: "assistant" as const,
          content: "Assistant reply",
          timestamp: "2025-01-01T00:01:00Z",
        },
      ];
      vi.mocked(api.chat.history).mockResolvedValue({ messages: persistedMessages } as never);

      await store.dispatch(fetchSketchChat("proj-1"));

      const msgs = store.getState().sketch.messages;
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe("user");
      expect(msgs[0].content).toBe("hello");
      expect(msgs[1].role).toBe("assistant");
      expect(msgs[1].content).toBe("Assistant reply");
    });
  });

  describe("fetchPrd thunk", () => {
    it("stores parsed PRD sections on fulfilled", async () => {
      vi.mocked(api.prd.get).mockResolvedValue({
        sections: {
          overview: { content: "Overview", version: 1, updatedAt: "" },
          goals: { content: "Goals", version: 1, updatedAt: "" },
        },
      } as never);
      const store = createStore();
      await store.dispatch(fetchPrd("proj-1"));

      expect(store.getState().sketch.prdContent).toEqual({ overview: "Overview", goals: "Goals" });
      expect(api.prd.get).toHaveBeenCalledWith("proj-1");
    });

    it("sets prdContent to {} when PRD not found (404)", async () => {
      const err = new Error("PRD not found for this project") as Error & { code: string };
      err.code = "PRD_NOT_FOUND";
      vi.mocked(api.prd.get).mockRejectedValue(err);
      const store = createStore();
      store.dispatch(setPrdContent({ overview: "stale" }));

      await store.dispatch(fetchPrd("proj-1"));

      expect(store.getState().sketch.prdContent).toEqual({});
    });
  });

  describe("fetchPrdHistory thunk", () => {
    it("stores history on fulfilled", async () => {
      const history = [
        {
          section: "executive_summary" as const,
          version: 1,
          source: "sketch" as const,
          timestamp: "2025-01-01",
          diff: "old",
        },
      ];
      vi.mocked(api.prd.getHistory).mockResolvedValue(history as never);
      const store = createStore();
      await store.dispatch(fetchPrdHistory("proj-1"));

      expect(store.getState().sketch.prdHistory).toEqual(history);
      expect(api.prd.getHistory).toHaveBeenCalledWith("proj-1");
    });

    it("uses empty array when data is null", async () => {
      vi.mocked(api.prd.getHistory).mockResolvedValue(null as never);
      const store = createStore();
      await store.dispatch(fetchPrdHistory("proj-1"));

      expect(store.getState().sketch.prdHistory).toEqual([]);
    });
  });

  describe("sendSketchMessage thunk", () => {
    it("sets sendingChat true on pending", async () => {
      let resolveApi: (v: { message: string }) => void;
      const apiPromise = new Promise<{ message: string }>((r) => {
        resolveApi = r;
      });
      vi.mocked(api.chat.send).mockReturnValue(apiPromise as never);
      const store = createStore();
      const dispatchPromise = store.dispatch(
        sendSketchMessage({ projectId: "proj-1", message: "Hello" })
      );

      expect(store.getState().sketch.sendingChat).toBe(true);
      expect(store.getState().sketch.error).toBeNull();

      resolveApi!({ message: "Response" });
      await dispatchPromise;
    });

    it("appends assistant message and clears sendingChat on fulfilled", async () => {
      vi.mocked(api.chat.send).mockResolvedValue({ message: "Here is my response" } as never);
      const store = createStore();
      await store.dispatch(sendSketchMessage({ projectId: "proj-1", message: "hello" }));

      const state = store.getState().sketch;
      expect(state.sendingChat).toBe(false);
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].role).toBe("assistant");
      expect(state.messages[0].content).toBe("Here is my response");
      expect(api.chat.send).toHaveBeenCalledWith("proj-1", "hello", "sketch", undefined, undefined);
    });

    it("passes requestOptions through when provided", async () => {
      vi.mocked(api.chat.send).mockResolvedValue({ message: "Here is my response" } as never);
      const store = createStore();
      await store.dispatch(
        sendSketchMessage({
          projectId: "proj-1",
          message: "Build a todo app",
          requestOptions: { timeoutMs: null },
        })
      );

      expect(api.chat.send).toHaveBeenCalledWith(
        "proj-1",
        "Build a todo app",
        "sketch",
        undefined,
        undefined,
        undefined,
        { timeoutMs: null }
      );
    });

    it("optimistically applies prdChanges from Dreamer response to prdContent", async () => {
      vi.mocked(api.chat.send).mockResolvedValue({
        message: "I've updated the PRD.",
        prdChanges: [
          {
            section: "executive_summary",
            previousVersion: 0,
            newVersion: 1,
            content: "Updated executive summary from Dreamer.",
          },
        ],
      } as never);
      const store = createStore();
      store.dispatch(setPrdContent({ problem_statement: "Existing" }));

      await store.dispatch(sendSketchMessage({ projectId: "proj-1", message: "hello" }));

      const state = store.getState().sketch;
      expect(state.prdContent.executive_summary).toBe("Updated executive summary from Dreamer.");
      expect(state.prdContent.problem_statement).toBe("Existing");
    });

    it("applies prdChanges when prdContent is empty (first Dreamer response)", async () => {
      vi.mocked(api.chat.send).mockResolvedValue({
        message: "Here's your initial PRD.",
        prdChanges: [
          {
            section: "executive_summary",
            previousVersion: 0,
            newVersion: 1,
            content: "Initial summary from Dreamer.",
          },
        ],
      } as never);
      const store = createStore();

      await store.dispatch(sendSketchMessage({ projectId: "proj-1", message: "Build a todo app" }));

      expect(store.getState().sketch.prdContent.executive_summary).toBe(
        "Initial summary from Dreamer."
      );
    });

    it("sets error on rejected", async () => {
      vi.mocked(api.chat.send).mockRejectedValue(new Error("Send failed"));
      const store = createStore();
      await store.dispatch(sendSketchMessage({ projectId: "proj-1", message: "hello" }));

      expect(store.getState().sketch.sendingChat).toBe(false);
      expect(store.getState().sketch.error).toBe("Send failed");
    });

    it("uses fallback error message when error has no message", async () => {
      vi.mocked(api.chat.send).mockRejectedValue(new Error());
      const store = createStore();
      await store.dispatch(sendSketchMessage({ projectId: "proj-1", message: "hello" }));

      expect(store.getState().sketch.error).toBe("Failed to send message");
    });
  });

  describe("savePrdSection thunk", () => {
    it("adds section to savingSections on pending", async () => {
      let resolveApi: () => void;
      const apiPromise = new Promise<void>((r) => {
        resolveApi = r;
      });
      vi.mocked(api.prd.updateSection).mockReturnValue(apiPromise as never);
      const store = createStore();
      const dispatchPromise = store.dispatch(
        savePrdSection({ projectId: "proj-1", section: "overview", content: "New content" })
      );

      expect(store.getState().sketch.savingSections).toContain("overview");

      resolveApi!();
      await dispatchPromise;
    });

    it("removes section from savingSections on fulfilled", async () => {
      vi.mocked(api.prd.updateSection).mockResolvedValue(undefined as never);
      const store = createStore();
      await store.dispatch(
        savePrdSection({ projectId: "proj-1", section: "overview", content: "Content" })
      );

      expect(store.getState().sketch.savingSections).not.toContain("overview");
      expect(api.prd.updateSection).toHaveBeenCalledWith("proj-1", "overview", "Content");
    });

    it("removes section from savingSections and sets error on rejected", async () => {
      vi.mocked(api.prd.updateSection).mockRejectedValue(new Error("Save failed"));
      const store = createStore();
      await store.dispatch(
        savePrdSection({ projectId: "proj-1", section: "overview", content: "Content" })
      );

      expect(store.getState().sketch.savingSections).not.toContain("overview");
      expect(store.getState().sketch.error).toBe("Save failed");
    });
  });

  describe("uploadPrdFile thunk", () => {
    it("sends chat for .md file and appends message on fulfilled", async () => {
      vi.mocked(api.chat.send).mockResolvedValue({ message: "Parsed PRD" } as never);
      const store = createStore();
      const file = new File(["# PRD content"], "doc.md", { type: "text/markdown" });
      await store.dispatch(uploadPrdFile({ projectId: "proj-1", file }));

      const state = store.getState().sketch;
      expect(state.sendingChat).toBe(false);
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].content).toBe("Parsed PRD");
      expect(api.chat.send).toHaveBeenCalled();
    });

    it("applies prdChanges from Dreamer response to prdContent on upload", async () => {
      vi.mocked(api.chat.send).mockResolvedValue({
        message: "I've created a PRD from your document.",
        prdChanges: [
          {
            section: "executive_summary",
            previousVersion: 0,
            newVersion: 1,
            content: "Summary from uploaded doc.",
          },
          {
            section: "problem_statement",
            previousVersion: 0,
            newVersion: 1,
            content: "Problem from uploaded doc.",
          },
        ],
      } as never);
      const store = createStore();
      const file = new File(["# PRD content"], "doc.md", { type: "text/markdown" });
      await store.dispatch(uploadPrdFile({ projectId: "proj-1", file }));

      const state = store.getState().sketch;
      expect(state.prdContent.executive_summary).toBe("Summary from uploaded doc.");
      expect(state.prdContent.problem_statement).toBe("Problem from uploaded doc.");
    });

    it("sets sendingChat true on pending", async () => {
      let resolveApi: (v: { response: { message: string } | null; fileName: string }) => void;
      const apiPromise = new Promise<{ response: { message: string } | null; fileName: string }>(
        (r) => {
          resolveApi = r;
        }
      );
      vi.mocked(api.chat.send).mockReturnValue(apiPromise as never);
      const store = createStore();
      const file = new File(["content"], "doc.md", { type: "text/markdown" });
      const dispatchPromise = store.dispatch(uploadPrdFile({ projectId: "proj-1", file }));

      expect(store.getState().sketch.sendingChat).toBe(true);

      resolveApi!({ response: { message: "Done" }, fileName: "doc.md" });
      await dispatchPromise;
    });

    it("sets error on rejected", async () => {
      vi.mocked(api.chat.send).mockRejectedValue(new Error("Upload failed"));
      const store = createStore();
      const file = new File(["content"], "doc.md", { type: "text/markdown" });
      await store.dispatch(uploadPrdFile({ projectId: "proj-1", file }));

      expect(store.getState().sketch.sendingChat).toBe(false);
      expect(store.getState().sketch.error).toBe("Upload failed");
    });

    it("throws for unsupported file type", async () => {
      const store = createStore();
      const file = new File(["content"], "doc.txt", { type: "text/plain" });
      const result = await store.dispatch(uploadPrdFile({ projectId: "proj-1", file }));

      expect(result.type).toBe("sketch/uploadPrdFile/rejected");
    });
  });
});
