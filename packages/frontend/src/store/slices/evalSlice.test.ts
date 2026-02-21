import { describe, it, expect, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import evalReducer, { updateFeedbackItem, type EvalState } from "./evalSlice";
import type { FeedbackItem } from "@opensprint/shared";

vi.mock("../../api/client", () => ({
  api: {
    feedback: {
      list: vi.fn().mockResolvedValue([]),
      submit: vi.fn(),
      recategorize: vi.fn(),
      resolve: vi.fn(),
    },
  },
}));

function createStore(initialState?: Partial<EvalState>) {
  return configureStore({
    reducer: { eval: evalReducer },
    preloadedState: initialState ? { eval: initialState } : undefined,
  });
}

const baseItem: FeedbackItem = {
  id: "fb-1",
  text: "Original text",
  category: "bug",
  mappedPlanId: null,
  createdTaskIds: [],
  status: "pending",
  createdAt: "2024-01-01T00:00:00Z",
};

describe("evalSlice", () => {
  describe("updateFeedbackItem", () => {
    it("updates an existing feedback item in place by id", () => {
      const store = createStore({
        feedback: [
          baseItem,
          { ...baseItem, id: "fb-2", text: "Second" },
        ],
        loading: false,
        submitting: false,
        error: null,
      });

      const updated: FeedbackItem = {
        ...baseItem,
        status: "mapped",
        category: "feature",
        mappedPlanId: "plan-1",
        createdTaskIds: ["task-1"],
      };

      store.dispatch(updateFeedbackItem(updated));

      const state = store.getState().eval;
      expect(state.feedback).toHaveLength(2);
      expect(state.feedback[0]).toEqual(updated);
      expect(state.feedback[1]).toEqual({ ...baseItem, id: "fb-2", text: "Second" });
    });

    it("leaves list unchanged when item id is not in the list", () => {
      const store = createStore({
        feedback: [baseItem],
        loading: false,
        submitting: false,
        error: null,
      });

      const otherItem: FeedbackItem = {
        ...baseItem,
        id: "fb-other",
        text: "From another tab",
        status: "resolved",
      };

      store.dispatch(updateFeedbackItem(otherItem));

      const state = store.getState().eval;
      expect(state.feedback).toHaveLength(1);
      expect(state.feedback[0]).toEqual(baseItem);
    });

    it("preserves list order and other items when updating one", () => {
      const store = createStore({
        feedback: [
          { ...baseItem, id: "fb-a" },
          { ...baseItem, id: "fb-b", text: "B" },
          { ...baseItem, id: "fb-c", text: "C" },
        ],
        loading: false,
        submitting: false,
        error: null,
      });

      store.dispatch(
        updateFeedbackItem({
          ...baseItem,
          id: "fb-b",
          text: "B updated",
          status: "resolved",
        })
      );

      const state = store.getState().eval;
      expect(state.feedback[0].id).toBe("fb-a");
      expect(state.feedback[1].id).toBe("fb-b");
      expect(state.feedback[1].text).toBe("B updated");
      expect(state.feedback[1].status).toBe("resolved");
      expect(state.feedback[2].id).toBe("fb-c");
    });
  });
});
