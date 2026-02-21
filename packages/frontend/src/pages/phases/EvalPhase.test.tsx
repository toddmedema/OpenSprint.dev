import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { EvalPhase, EVALUATE_FEEDBACK_FILTER_KEY } from "./EvalPhase";
import projectReducer from "../../store/slices/projectSlice";
import websocketReducer from "../../store/slices/websocketSlice";
import sketchReducer from "../../store/slices/sketchSlice";
import planReducer from "../../store/slices/planSlice";
import executeReducer from "../../store/slices/executeSlice";
import taskRegistryReducer from "../../store/slices/taskRegistrySlice";
import evalReducer from "../../store/slices/evalSlice";
import deliverReducer from "../../store/slices/deliverSlice";
import notificationReducer from "../../store/slices/notificationSlice";
import type { FeedbackItem, Task } from "@opensprint/shared";

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
    tasks: {
      get: vi.fn().mockImplementation((_projectId: string, taskId: string) =>
        Promise.resolve({
          id: taskId,
          title: `Task title for ${taskId}`,
          description: "",
          type: "task",
          status: "open",
          priority: 1,
          assignee: null,
          labels: [],
          dependencies: [],
          epicId: null,
          kanbanColumn: "backlog",
          createdAt: "",
          updatedAt: "",
        })
      ),
    },
  },
}));

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Fix login bug",
    description: "",
    type: "task",
    status: "open",
    priority: 0,
    assignee: null,
    labels: [],
    dependencies: [],
    epicId: null,
    kanbanColumn: "in_progress",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function createStore(overrides?: {
  evalFeedback?: FeedbackItem[];
  executeTasks?: Task[];
}) {
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
  if (overrides?.executeTasks !== undefined) {
    preloadedState.execute = {
      tasks: overrides.executeTasks,
      plans: [],
      orchestratorRunning: false,
      awaitingApproval: false,
      activeTasks: [],
      selectedTaskId: null,
      taskDetail: null,
      taskDetailLoading: false,
      taskDetailError: null,
      agentOutput: {},
      completionState: null,
      archivedSessions: [],
      archivedLoading: false,
      markDoneLoading: false,
      unblockLoading: false,
      statusLoading: false,
      loading: false,
      error: null,
    };
    preloadedState.taskRegistry = {
      byProject: {
        "proj-1": Object.fromEntries(
          overrides.executeTasks.map((t) => [
            t.id,
            { title: t.title, kanbanColumn: t.kanbanColumn, priority: t.priority },
          ])
        ),
      },
    };
  }
  return configureStore({
    reducer: {
      project: projectReducer,
      websocket: websocketReducer,
      sketch: sketchReducer,
      plan: planReducer,
      execute: executeReducer,
      taskRegistry: taskRegistryReducer,
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
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <EvalPhase projectId="proj-1" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("feedback-priority-select")).toBeInTheDocument();
    });

    const trigger = screen.getByTestId("feedback-priority-select");
    expect(trigger).toHaveAttribute("aria-label", "Priority (optional)");
    expect(trigger).toHaveClass("input");
    expect(trigger).toHaveClass("h-10");

    await user.click(trigger);

    // Placeholder / clear option
    expect(screen.getByTestId("feedback-priority-option-clear")).toHaveTextContent(
      "No priority"
    );
    // Priority options with icons
    expect(screen.getByTestId("feedback-priority-option-0")).toBeInTheDocument();
    expect(screen.getByTestId("feedback-priority-option-1")).toBeInTheDocument();
    expect(screen.getByTestId("feedback-priority-option-2")).toBeInTheDocument();
    expect(screen.getByTestId("feedback-priority-option-3")).toBeInTheDocument();
    expect(screen.getByTestId("feedback-priority-option-4")).toBeInTheDocument();
  });

  it("closes priority dropdown on Escape key", async () => {
    const store = createStore();
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <EvalPhase projectId="proj-1" />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("feedback-priority-select")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("feedback-priority-select"));
    expect(screen.getByTestId("feedback-priority-dropdown")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("feedback-priority-dropdown")).not.toBeInTheDocument();
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
    await user.click(screen.getByTestId("feedback-priority-select"));
    await user.click(screen.getByTestId("feedback-priority-option-0"));
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
    await user.click(screen.getByTestId("feedback-priority-select"));
    await user.click(screen.getByTestId("feedback-priority-option-2"));
    await user.click(screen.getByRole("button", { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(api.feedback.submit).toHaveBeenCalled();
    });

    // After submission, input and priority should be cleared
    const trigger = screen.getByTestId("feedback-priority-select");
    expect(trigger).toHaveTextContent("Priority (optional)");
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
      expect(prioritySelect).toHaveClass("min-h-10");
      expect(attachButton).toHaveClass("h-10");
      expect(submitButton).toHaveClass("h-10");
    });

    it("actions row uses items-stretch so all controls share the same height", async () => {
      const store = createStore();
      const { container } = render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-priority-select")).toBeInTheDocument();
      });

      const actionsRow =
        container.querySelector('[data-testid="feedback-priority-select"]')?.parentElement
          ?.parentElement;
      expect(actionsRow).toBeTruthy();
      expect(actionsRow).toHaveClass("items-stretch");
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

      const actionsRow =
        container.querySelector('[data-testid="feedback-priority-select"]')?.parentElement
          ?.parentElement;
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

  describe("Attach image button tooltip", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows Attach image(s) tooltip on main feedback form after hover delay", async () => {
      const store = createStore();
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-attach-image")).toBeInTheDocument();
      });

      const attachButton = screen.getByRole("button", { name: /Attach image/i });
      await userEvent.hover(attachButton);
      act(() => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => {
        const tooltip = screen.getByRole("tooltip");
        expect(tooltip).toHaveTextContent("Attach image(s)");
      });
    });

    it("dismisses attach image tooltip when cursor leaves button", async () => {
      const store = createStore();
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-attach-image")).toBeInTheDocument();
      });

      const attachButton = screen.getByRole("button", { name: /Attach image/i });
      await userEvent.hover(attachButton);
      act(() => {
        vi.advanceTimersByTime(300);
      });

      await waitFor(() => expect(screen.getByRole("tooltip")).toBeInTheDocument());

      await userEvent.unhover(attachButton);

      await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    });
  });

  describe("feedback status filter", () => {
    beforeEach(() => {
      localStorage.removeItem(EVALUATE_FEEDBACK_FILTER_KEY);
    });

    it("defaults to All when no localStorage key exists", async () => {
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
      expect(filterSelect.value).toBe("all");
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

    it("each dropdown option displays its count (All = total, Pending = pending+mapped, Resolved)", async () => {
      const store = createStore({ evalFeedback: mockFeedbackItems });
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-status-filter")).toBeInTheDocument();
      });

      expect(screen.getByRole("option", { name: "All (6)" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Pending (5)" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Resolved (1)" })).toBeInTheDocument();
    });

    it("All option appears first in dropdown above Pending and Resolved", async () => {
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
      const options = Array.from(filterSelect.options).map((o) => o.value);
      expect(options).toEqual(["all", "pending", "resolved"]);
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

      await user.selectOptions(screen.getByTestId("feedback-status-filter"), "all");
      expect(localStorage.getItem(EVALUATE_FEEDBACK_FILTER_KEY)).toBe("all");

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

    it("restores 'all' from localStorage when previously selected", async () => {
      localStorage.setItem(EVALUATE_FEEDBACK_FILTER_KEY, "all");

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
      expect(filterSelect.value).toBe("all");
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

    it("falls back to All when localStorage has invalid value", async () => {
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
      expect(filterSelect.value).toBe("all");
    });

    it("Pending filter shows both pending and mapped items", async () => {
      localStorage.setItem(EVALUATE_FEEDBACK_FILTER_KEY, "pending");
      const store = createStore({ evalFeedback: mockFeedbackItems });
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => expect(screen.getByTestId("feedback-status-filter")).toBeInTheDocument());

      const filterSelect = screen.getByTestId("feedback-status-filter") as HTMLSelectElement;
      expect(filterSelect.value).toBe("pending");

      // Pending filter shows 5 items: 2 pending + 3 mapped
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

    it("All filter shows feedback of every status", async () => {
      const store = createStore({ evalFeedback: mockFeedbackItems });
      const user = userEvent.setup();
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => expect(screen.getByTestId("feedback-status-filter")).toBeInTheDocument());

      await user.selectOptions(screen.getByTestId("feedback-status-filter"), "all");

      expect(screen.getByText("Bug 1")).toBeInTheDocument();
      expect(screen.getByText("Bug 2")).toBeInTheDocument();
      expect(screen.getByText("Bug 3")).toBeInTheDocument();
      expect(screen.getByText("Bug 4")).toBeInTheDocument();
      expect(screen.getByText("Bug 5")).toBeInTheDocument();
      expect(screen.getByText("Bug 6")).toBeInTheDocument();
    });
  });

  describe("feedback card task chips", () => {
    it("shows priority icon in each created-task chip", async () => {
      const feedbackWithTasks: FeedbackItem[] = [
        {
          id: "fb-mapped",
          text: "Auth bug",
          category: "bug",
          mappedPlanId: null,
          createdTaskIds: ["task-1", "task-2"],
          status: "mapped",
          createdAt: "2024-01-01T00:00:01Z",
        },
      ];
      const executeTasks: Task[] = [
        createMockTask({ id: "task-1", priority: 0 }),
        createMockTask({ id: "task-2", priority: 2 }),
      ];
      const store = createStore({
        evalFeedback: feedbackWithTasks,
        executeTasks,
      });

      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-card-ticket-info")).toBeInTheDocument();
      });

      // PriorityIcon uses role="img" and aria-label for each priority level
      expect(screen.getByRole("img", { name: "Critical" })).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Medium" })).toBeInTheDocument();
    });

    it("defaults to High icon when task not found in state", async () => {
      const feedbackWithTasks: FeedbackItem[] = [
        {
          id: "fb-mapped",
          text: "Orphan task",
          category: "feature",
          mappedPlanId: null,
          createdTaskIds: ["unknown-task-id"],
          status: "mapped",
          createdAt: "2024-01-01T00:00:01Z",
        },
      ];
      const store = createStore({
        evalFeedback: feedbackWithTasks,
        executeTasks: [],
      });

      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-card-ticket-info")).toBeInTheDocument();
      });

      // Unknown task defaults to priority 1 (High)
      expect(screen.getByRole("img", { name: "High" })).toBeInTheDocument();
    });

    it("shows task title as link text instead of task ID when task is in execute state", async () => {
      const feedbackWithTasks: FeedbackItem[] = [
        {
          id: "fb-mapped",
          text: "Auth bug",
          category: "bug",
          mappedPlanId: null,
          createdTaskIds: ["task-1"],
          status: "mapped",
          createdAt: "2024-01-01T00:00:01Z",
        },
      ];
      const executeTasks: Task[] = [
        createMockTask({ id: "task-1", title: "Fix login button styling" }),
      ];
      const store = createStore({
        evalFeedback: feedbackWithTasks,
        executeTasks,
      });

      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-card-ticket-info")).toBeInTheDocument();
      });

      expect(screen.getByText("Fix login button styling")).toBeInTheDocument();
      expect(screen.queryByText("task-1")).not.toBeInTheDocument();
    });

    it("truncates task title to 30 characters with ellipsis when longer", async () => {
      const longTitle = "This is a very long task title that exceeds thirty characters";
      const feedbackWithTasks: FeedbackItem[] = [
        {
          id: "fb-mapped",
          text: "Feature request",
          category: "feature",
          mappedPlanId: null,
          createdTaskIds: ["task-long"],
          status: "mapped",
          createdAt: "2024-01-01T00:00:01Z",
        },
      ];
      const executeTasks: Task[] = [
        createMockTask({ id: "task-long", title: longTitle }),
      ];
      const store = createStore({
        evalFeedback: feedbackWithTasks,
        executeTasks,
      });

      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-card-ticket-info")).toBeInTheDocument();
      });

      expect(screen.getByText("This is a very long task title…")).toBeInTheDocument();
      expect(screen.queryByText(longTitle)).not.toBeInTheDocument();
    });

    it("does not show tooltip on hover", async () => {
      const feedbackWithTasks: FeedbackItem[] = [
        {
          id: "fb-mapped",
          text: "Auth bug",
          category: "bug",
          mappedPlanId: null,
          createdTaskIds: ["task-1"],
          status: "mapped",
          createdAt: "2024-01-01T00:00:01Z",
        },
      ];
      const executeTasks: Task[] = [createMockTask({ id: "task-1" })];
      const store = createStore({
        evalFeedback: feedbackWithTasks,
        executeTasks,
      });

      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-card-ticket-info")).toBeInTheDocument();
      });

      const link = screen.getByText("Fix login bug");
      const user = userEvent.setup();
      await user.hover(link);

      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    it("navigates to correct task when link is clicked", async () => {
      const onNavigateToBuildTask = vi.fn();
      const feedbackWithTasks: FeedbackItem[] = [
        {
          id: "fb-mapped",
          text: "Auth bug",
          category: "bug",
          mappedPlanId: null,
          createdTaskIds: ["task-1"],
          status: "mapped",
          createdAt: "2024-01-01T00:00:01Z",
        },
      ];
      const executeTasks: Task[] = [createMockTask({ id: "task-1" })];
      const store = createStore({
        evalFeedback: feedbackWithTasks,
        executeTasks,
      });

      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" onNavigateToBuildTask={onNavigateToBuildTask} />
        </Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("feedback-card-ticket-info")).toBeInTheDocument();
      });

      const user = userEvent.setup();
      await user.click(screen.getByText("Fix login bug"));

      expect(onNavigateToBuildTask).toHaveBeenCalledWith("task-1");
    });
  });

  describe("reply image attachment", () => {
    it("shows Attach image(s) button in reply composer to the left of Submit Reply", async () => {
      const store = createStore({ evalFeedback: mockFeedbackItems });
      const user = userEvent.setup();
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => expect(screen.getByText("Bug 1")).toBeInTheDocument());

      const bug1Card = screen.getByText("Bug 1").closest(".card");
      await user.click(within(bug1Card!).getByRole("button", { name: /^Reply$/ }));
      await waitFor(() => {
        expect(screen.getByPlaceholderText("Write a reply...")).toBeInTheDocument();
      });

      const attachButton = screen.getByTestId("reply-attach-images");
      const submitButton = screen.getByRole("button", { name: /Submit Reply/i });
      expect(attachButton).toBeInTheDocument();
      expect(attachButton).toHaveAttribute("aria-label", "Attach image(s)");
      expect(attachButton).toHaveTextContent("Attach image(s)");

      // Attach button should appear before Submit Reply in DOM order
      const actionsRow = submitButton.closest(".flex");
      expect(actionsRow).toBeTruthy();
      const buttons = actionsRow!.querySelectorAll("button");
      const attachIndex = Array.from(buttons).findIndex((b) => b === attachButton);
      const submitIndex = Array.from(buttons).findIndex((b) => b === submitButton);
      expect(attachIndex).toBeGreaterThanOrEqual(0);
      expect(submitIndex).toBeGreaterThan(attachIndex);
    });

    it("persists attached images when submitting reply", async () => {
      const { api } = await import("../../api/client");
      const store = createStore({ evalFeedback: mockFeedbackItems });
      const user = userEvent.setup();
      render(
        <Provider store={store}>
          <EvalPhase projectId="proj-1" />
        </Provider>
      );

      await waitFor(() => expect(screen.getByText("Bug 1")).toBeInTheDocument());

      const bug1Card = screen.getByText("Bug 1").closest(".card");
      await user.click(within(bug1Card!).getByRole("button", { name: /^Reply$/ }));
      await waitFor(() => {
        expect(screen.getByPlaceholderText("Write a reply...")).toBeInTheDocument();
      });

      // Create minimal valid PNG (1x1 pixel)
      const base64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], "test.png", { type: "image/png" });

      const fileInput = screen.getByTestId("reply-attach-images-input");
      await user.upload(fileInput, file);

      await waitFor(() => {
        expect(screen.getByAltText("Attachment 1")).toBeInTheDocument();
      });

      await user.type(screen.getByPlaceholderText("Write a reply..."), "Here is a screenshot");
      await user.click(screen.getByRole("button", { name: /Submit Reply/i }));

      await waitFor(() => {
        expect(api.feedback.submit).toHaveBeenCalledWith(
          "proj-1",
          "Here is a screenshot",
          expect.any(Array),
          "fb-1",
          undefined
        );
      });
      const call = vi.mocked(api.feedback.submit).mock.calls[0];
      expect(call[2]).toHaveLength(1);
      expect(call[2]![0]).toContain("data:image/png;base64,");
    });
  });
});
