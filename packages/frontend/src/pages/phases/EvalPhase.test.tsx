import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { EvalPhase } from "./EvalPhase";
import projectReducer from "../../store/slices/projectSlice";
import websocketReducer from "../../store/slices/websocketSlice";
import sketchReducer from "../../store/slices/sketchSlice";
import planReducer from "../../store/slices/planSlice";
import executeReducer from "../../store/slices/executeSlice";
import evalReducer, { submitFeedback } from "../../store/slices/evalSlice";
import deliverReducer from "../../store/slices/deliverSlice";
import notificationReducer from "../../store/slices/notificationSlice";

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

function createStore() {
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
    preloadedState: {
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
    },
  });
}

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
      () => new Promise((r) => { resolveSubmit = r; })
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
});
