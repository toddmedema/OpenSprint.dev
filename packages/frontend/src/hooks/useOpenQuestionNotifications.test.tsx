import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import type { ReactNode } from "react";
import { useOpenQuestionNotifications } from "./useOpenQuestionNotifications";
import openQuestionsReducer from "../store/slices/openQuestionsSlice";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    notifications: {
      listByProject: vi.fn(),
    },
  },
}));

function createWrapper(preloadedNotifications: unknown[] = []) {
  const store = configureStore({
    reducer: {
      openQuestions: openQuestionsReducer,
    },
    preloadedState: {
      openQuestions: {
        byProject: { p1: preloadedNotifications },
        global: [],
        async: {
          project: {},
          global: { loading: false },
        },
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe("useOpenQuestionNotifications", () => {
  beforeEach(() => {
    vi.mocked(api.notifications.listByProject).mockResolvedValue([]);
  });

  it("returns empty notifications and a refetch function when projectId is null", () => {
    const { result } = renderHook(() => useOpenQuestionNotifications(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.notifications).toEqual([]);
    expect(typeof result.current.refetch).toBe("function");
    expect(api.notifications.listByProject).not.toHaveBeenCalled();
  });

  it("reads notifications from Redux state", () => {
    const mockNotifications = [
      {
        id: "notif-1",
        projectId: "p1",
        source: "plan" as const,
        sourceId: "plan-1",
        questions: [{ id: "q1", text: "Question?", createdAt: "2025-01-01T00:00:00Z" }],
        status: "open" as const,
        createdAt: "2025-01-01T00:00:00Z",
        resolvedAt: null,
      },
    ];

    const { result } = renderHook(() => useOpenQuestionNotifications("p1"), {
      wrapper: createWrapper(mockNotifications),
    });

    expect(result.current.notifications).toEqual(mockNotifications);
  });

  it("refetches notifications through the Redux thunk", async () => {
    const mockNotifications = [
      {
        id: "notif-2",
        projectId: "p1",
        source: "eval" as const,
        sourceId: "feedback-1",
        questions: [{ id: "q2", text: "Need more detail", createdAt: "2025-01-01T00:00:00Z" }],
        status: "open" as const,
        createdAt: "2025-01-01T00:00:00Z",
        resolvedAt: null,
      },
    ];
    vi.mocked(api.notifications.listByProject).mockResolvedValue(mockNotifications);

    const { result } = renderHook(() => useOpenQuestionNotifications("p1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.notifications).toEqual(mockNotifications);
    });
    expect(api.notifications.listByProject).toHaveBeenCalledWith("p1");
  });
});
