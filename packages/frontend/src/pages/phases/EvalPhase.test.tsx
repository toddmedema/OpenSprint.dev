import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { EvalPhase, EVALUATE_FEEDBACK_FILTER_KEY } from "./EvalPhase";
import projectReducer from "../../store/slices/projectSlice";
import websocketReducer from "../../store/slices/websocketSlice";
import sketchReducer from "../../store/slices/sketchSlice";
import planReducer from "../../store/slices/planSlice";
import executeReducer from "../../store/slices/executeSlice";
import evalReducer from "../../store/slices/evalSlice";
import deliverReducer from "../../store/slices/deliverSlice";
import notificationReducer from "../../store/slices/notificationSlice";
import type { FeedbackItem } from "@opensprint/shared";

vi.mock("../../api/client", () => ({
  api: {
    feedback: {
      list: vi.fn().mockResolvedValue([]),
      submit: vi.fn().mockResolvedValue({
        id: "fb-new",
        text: "Test feedback",
        category: "bug",
        mappedPlanId: null,
        createdTaskIds: [],
        status: "pending",
        createdAt: new Date().toISOString(),
      }),
    },
  },
}));

function createStore(overrides?: { evalFeedback?: FeedbackItem[] }) {
  const preloadedState: Record<string, unknown> = {
    project: {
      data: {
        id: "proj-1",
        name: "Test Project",
        repoPath: "/tmp/test",
        currentPhase: "eval",
        createdAt: "",
        updatedAt: "",
      },
      loading: false,
      error: null,
    },
  };
  if (overrides?.evalFeedback) {
    preloadedState.eval = {
      feedback: overrides.evalFeedback,
      loading: false,
      submitting: false,
      error: null,
    };
  }
  return configureStore({
    reducer: {
      project: projectReducer,
      websocket: websocketReducer,
      sketch: sketchReducer,
      plan: planReducer,
      execute: executeReducer,
      eval: evalReducer,
      deliver: deliverReducer,
      notification: notificationReducer,
    },
    preloadedState,
  });
}

const mockFeedbackItems: FeedbackItem[] = [
  { id: "fb-1", text: "Bug 1", category: "bug", mappedPlanId: null, createdTaskIds: [], status: "pending", createdAt: "2024-01-01T00:00:01Z" },
  { id: "fb-2", text: "Bug 2", category: "bug", mappedPlanId: null, createdTaskIds: [], status: "pending", createdAt: "2024-01-01T00:00:02Z" },
  { id: "fb-3", text: "Bug 3", category: "bug", mappedPlanId: null, createdTaskIds: [], status: "mapped", createdAt: "2024-01-01T00:00:03Z" },
  { id: "fb-4", text: "Bug 4", category: "bug", mappedPlanId: null, createdTaskIds: [], status: "mapped", createdAt: "2024-01-01T00:00:04Z" },
  { id: "fb-5", text: "Bug 5", category: "bug", mappedPlanId: null, createdTaskIds: [], status: "mapped", createdAt: "2024-01-01T00:00:05Z" },
  { id: "fb-6", text: "Bug 6", category: "bug", mappedPlanId: null, createdTaskIds: [], status: "resolved", createdAt: "2024-01-01T00:00:06Z" },
];

describe("EvalPhase feedback form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders priority dropdown with placeholder and options", async () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <EvalPhase projectId="proj-1" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("feedback-priority-select")).toBeInTheDocument();
    });

    const select = screen.getByTestId("feedback-priority-select");
    expect(select).toHaveAttribute("aria-label", "Priority (optional)");
    expect(select).toHaveClass("input");
    expect(select).toHaveClass("h-10");

    // Placeholder option
    expect(screen.getByRole("option", { name: "Priority (optional)" })).toBeInTheDocument();
    // Priority options
    expect(screen.getByRole("option", { name: "Critical" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "High" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Medium" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Low" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Lowest" })).toBeInTheDocument();
  });

  it("passes selected priority when submitting feedback", async () => {
    const { api } = await import("../../api/client");
    const store = createStore();
    render(
      <Provider store={store}>
        <EvalPhase projectId="proj-1" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Describe a bug/)).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Describe a bug/), "Critical auth bug");
    await user.selectOptions(screen.getByTestId("feedback-priority-select"), "0");
    await user.click(screen.getByRole("button", { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(api.feedback.submit).toHaveBeenCalledWith(
        "proj-1",
        "Critical auth bug",
        undefined,
        undefined,
        0
      );
    });
  });

  it("clears priority after submission", async () => {
    const { api } = await import("../../api/client");
    vi.mocked(api.feedback.submit).mockResolvedValue({
      id: "fb-new",
      text: "Test feedback",
      category: "bug",
      mappedPlanId: null,
      createdTaskIds: [],
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    const store = createStore();
    render(
      <Provider store={store}>
        <EvalPhase projectId="proj-1" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Describe a bug/)).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Describe a bug/), "Some feedback");
    await user.selectOptions(screen.getByTestId("feedback-priority-select"), "2");
    await user.click(screen.getByRole("button", { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(api.feedback.submit).toHaveBeenCalled();
    });

    // After submission, input and priority should be cleared
    const select = screen.getByTestId("feedback-priority-select") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByPlaceholderText(/Describe a bug/)).toHaveValue("");
  });

  it("omits priority from submission when none selected", async () => {
    const { api } = await import("../../api/client");
    const store = createStore();
    render(
      <Provider store={store}>
        <EvalPhase projectId="proj-1" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Describe a bug/)).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Describe a bug/), "Feedback without priority");
    await user.click(screen.getByRole("button", { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(api.feedback.submit).toHaveBeenCalledWith(
        "proj-1",
        "Feedback without priority",
        undefined,
        undefined,
        undefined
      );
    });
  });

  it("disables priority dropdown while submitting", async () => {
    const { api } = await import("../../api/client");
    let resolveSubmit: (value: unknown) => void;
    vi.mocked(api.feedback.submit).mockImplementation(
      () =>
        new Promise((r) => {
          resolveSubmit = r;
        })
    );

    const store = createStore();
    render(
      <Provider store={store}>
        <EvalPhase projectId="proj-1" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Describe a bug/)).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Describe a bug/), "Test feedback");
    await user.click(screen.getByRole("button", { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(screen.getByTestId("feedback-priority-select")).toBeDisabled();
    });

    resolveSubmit!({
      id: "fb-new",
      text: "Test feedback",
      category: "bug",
      mappedPlanId: null,
      createdTaskIds: [],
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    await waitFor(() => {
      expect(screen.getByTestId("feedback-priority-select")).not.toBeDisabled();
    });
  });

  describe("feedback form control heights", () => {
    it("applies consistent h-10 height to priority select and both buttons", async () => {
      const store = createStore();
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-priority-select")).toBeInTheDocument();
      });

      const prioritySelect = screen.getByTestId("feedback-priority-select");
      const attachButton = screen.getByRole("button", { name: /Attach image/i });
      const submitButton = screen.getByRole("button", { name: /Submit Feedback/i });

      expect(prioritySelect).toHaveClass("h-10");
      expect(attachButton).toHaveClass("h-10");
      expect(submitButton).toHaveClass("h-10");
    });

    it("actions row has flex-wrap to prevent overflow at narrow viewports", async () => {
      const store = createStore();
      const { container } = render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-priority-select")).toBeInTheDocument();
      });

      const actionsRow = container.querySelector('[data-testid="feedback-priority-select"]')?.parentElement;
      expect(actionsRow).toBeTruthy();
      expect(actionsRow).toHaveClass("flex-wrap");
    });
  });

  describe("Submit Feedback button tooltip", () => {
    const originalNavigator = global.navigator;

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.stubGlobal("navigator", { ...originalNavigator });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.stubGlobal("navigator", originalNavigator);
    });

    it("shows Cmd + Enter tooltip on macOS after hover delay", async () => {
      vi.stubGlobal("navigator", {
        ...originalNavigator,
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      });

      const store = createStore();
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Submit Feedback/i })).toBeInTheDocument();
      });

      const submitButton = screen.getByRole("button", { name: /Submit Feedback/i });
      await userEvent.hover(submitButton);
      await waitFor(
        () => {
          const tooltip = screen.getByRole("tooltip");
          expect(tooltip).toHaveTextContent("Cmd + Enter to submit");
        },
        { timeout: 500 }
      );
    });

    it("shows Ctrl + Enter tooltip on Windows after hover delay", async () => {
      vi.stubGlobal("navigator", {
        ...originalNavigator,
        platform: "Win32",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      });

      const store = createStore();
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Submit Feedback/i })).toBeInTheDocument();
      });

      const submitButton = screen.getByRole("button", { name: /Submit Feedback/i });
      await userEvent.hover(submitButton);
      await waitFor(
        () => {
          const tooltip = screen.getByRole("tooltip");
          expect(tooltip).toHaveTextContent("Ctrl + Enter to submit");
        },
        { timeout: 500 }
      );
    });

    it("dismisses tooltip when cursor leaves button", async () => {
      vi.stubGlobal("navigator", {
        ...originalNavigator,
        platform: "Win32",
        userAgent: "Mozilla/5.0",
      });

      const store = createStore();
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Submit Feedback/i })).toBeInTheDocument();
      });

      const submitButton = screen.getByRole("button", { name: /Submit Feedback/i });
      await userEvent.hover(submitButton);
      await waitFor(() => expect(screen.getByRole("tooltip")).toBeInTheDocument(), {
        timeout: 500,
      });

      await userEvent.unhover(submitButton);
      await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(), {
        timeout: 200,
      });
    });
  });

  describe("feedback status filter", () => {
    beforeEach(() => {
      localStorage.removeItem(EVALUATE_FEEDBACK_FILTER_KEY);
    });

    it("defaults to Pending when no localStorage key exists", async () => {
      const store = createStore({ evalFeedback: mockFeedbackItems });
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-status-filter")).toBeInTheDocument();
      });

      const filterSelect = screen.getByTestId("feedback-status-filter") as HTMLSelectElement;
      expect(filterSelect.value).toBe("pending");
    });

    it("title does not display a count", async () => {
      const store = createStore({ evalFeedback: mockFeedbackItems });
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Feedback History" })).toBeInTheDocument();
      });

      const heading = screen.getByRole("heading", { name: "Feedback History" });
      expect(heading.textContent).toBe("Feedback History");
      expect(heading.textContent).not.toMatch(/\(\d+\)/);
    });

    it("each dropdown option displays its count (Pending = pending+mapped, Resolved)", async () => {
      const store = createStore({ evalFeedback: mockFeedbackItems });
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-status-filter")).toBeInTheDocument();
      });

      expect(screen.getByRole("option", { name: "Pending (5)" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Resolved (1)" })).toBeInTheDocument();
    });

    it("writes filter selection to localStorage on change", async () => {
      const store = createStore({ evalFeedback: mockFeedbackItems });
      const user = userEvent.setup();
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-status-filter")).toBeInTheDocument();
      });

      expect(localStorage.getItem(EVALUATE_FEEDBACK_FILTER_KEY)).toBeNull();

      await user.selectOptions(screen.getByTestId("feedback-status-filter"), "resolved");
      expect(localStorage.getItem(EVALUATE_FEEDBACK_FILTER_KEY)).toBe("resolved");

      await user.selectOptions(screen.getByTestId("feedback-status-filter"), "pending");
      expect(localStorage.getItem(EVALUATE_FEEDBACK_FILTER_KEY)).toBe("pending");
    });

    it("restores previously selected filter from localStorage on mount", async () => {
      localStorage.setItem(EVALUATE_FEEDBACK_FILTER_KEY, "resolved");

      const store = createStore({ evalFeedback: mockFeedbackItems });
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-status-filter")).toBeInTheDocument();
      });

      const filterSelect = screen.getByTestId("feedback-status-filter") as HTMLSelectElement;
      expect(filterSelect.value).toBe("resolved");
    });

    it("treats legacy localStorage 'mapped' as Pending", async () => {
      localStorage.setItem(EVALUATE_FEEDBACK_FILTER_KEY, "mapped");

      const store = createStore({ evalFeedback: mockFeedbackItems });
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-status-filter")).toBeInTheDocument();
      });

      const filterSelect = screen.getByTestId("feedback-status-filter") as HTMLSelectElement;
      expect(filterSelect.value).toBe("pending");
    });

    it("falls back to Pending when localStorage has invalid value", async () => {
      localStorage.setItem(EVALUATE_FEEDBACK_FILTER_KEY, "invalid");

      const store = createStore({ evalFeedback: mockFeedbackItems });
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-status-filter")).toBeInTheDocument();
      });

      const filterSelect = screen.getByTestId("feedback-status-filter") as HTMLSelectElement;
      expect(filterSelect.value).toBe("pending");
    });

    it("Pending filter shows both pending and mapped items", async () => {
      localStorage.removeItem(EVALUATE_FEEDBACK_FILTER_KEY);
      const store = createStore({ evalFeedback: mockFeedbackItems });
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => expect(screen.getByTestId("feedback-status-filter")).toBeInTheDocument());

      const filterSelect = screen.getByTestId("feedback-status-filter") as HTMLSelectElement;
      expect(filterSelect.value).toBe("pending");

      // Pending filter (default) shows 5 items: 2 pending + 3 mapped
      expect(screen.getByText("Bug 1")).toBeInTheDocument();
      expect(screen.getByText("Bug 2")).toBeInTheDocument();
      expect(screen.getByText("Bug 3")).toBeInTheDocument();
      expect(screen.getByText("Bug 4")).toBeInTheDocument();
      expect(screen.getByText("Bug 5")).toBeInTheDocument();
      expect(screen.queryByText("Bug 6")).not.toBeInTheDocument();
    });

    it("Resolved filter shows only resolved items", async () => {
      const store = createStore({ evalFeedback: mockFeedbackItems });
      const user = userEvent.setup();
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => expect(screen.getByTestId("feedback-status-filter")).toBeInTheDocument());

      await user.selectOptions(screen.getByTestId("feedback-status-filter"), "resolved");

      expect(screen.getByText("Bug 6")).toBeInTheDocument();
      expect(screen.queryByText("Bug 1")).not.toBeInTheDocument();
      expect(screen.queryByText("Bug 3")).not.toBeInTheDocument();
    });
  });
});
