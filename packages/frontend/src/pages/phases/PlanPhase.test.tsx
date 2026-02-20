// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { PlanPhase, DEPENDENCY_GRAPH_EXPANDED_KEY } from "./PlanPhase";
import projectReducer from "../../store/slices/projectSlice";
import planReducer from "../../store/slices/planSlice";
import executeReducer from "../../store/slices/executeSlice";
import notificationReducer from "../../store/slices/notificationSlice";

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const mockArchive = vi.fn().mockResolvedValue(undefined);
const mockExecute = vi.fn().mockResolvedValue(undefined);
const mockReExecute = vi.fn().mockResolvedValue(undefined);
const mockGetCrossEpicDependencies = vi.fn().mockResolvedValue({ prerequisitePlanIds: [] });
const mockPlansUpdate = vi.fn().mockResolvedValue({
  metadata: {
    planId: "archive-test-feature",
    beadEpicId: "epic-1",
    gateTaskId: "epic-1.0",
    complexity: "medium",
  },
  content: "# Updated Plan\n\nUpdated content.",
  status: "building",
  taskCount: 2,
  doneTaskCount: 0,
  dependencyCount: 0,
});
const mockChatSend = vi.fn().mockResolvedValue({ message: "AI response" });
const mockPlansList = vi.fn().mockResolvedValue({
  plans: [
    {
      metadata: {
        planId: "archive-test-feature",
        beadEpicId: "epic-1",
        gateTaskId: "epic-1.0",
        complexity: "medium",
      },
      content: "# Archive Test\n\nContent.",
      status: "building",
      taskCount: 2,
      doneTaskCount: 0,
      dependencyCount: 0,
    },
  ],
  edges: [],
});
const mockPlansGet = vi.fn().mockResolvedValue({
  metadata: {
    planId: "archive-test-feature",
    beadEpicId: "epic-1",
    gateTaskId: "epic-1.0",
    complexity: "medium",
  },
  content: "# Archive Test\n\nContent.",
  status: "building",
  taskCount: 2,
  doneTaskCount: 0,
  dependencyCount: 0,
});
const mockPlansCreate = vi.fn().mockResolvedValue({
  metadata: { planId: "new-feature", beadEpicId: "e1", gateTaskId: "e1.0", complexity: "medium" },
  content: "# New Feature\n\nContent.",
  status: "planning",
  taskCount: 0,
  doneTaskCount: 0,
  dependencyCount: 0,
});
const mockGenerate = vi.fn().mockResolvedValue({
  metadata: {
    planId: "generated-feature",
    beadEpicId: "e2",
    gateTaskId: "e2.0",
    complexity: "medium",
    shippedAt: null,
  },
  content: "# Generated Feature\n\nContent.",
  status: "planning",
  taskCount: 2,
  doneTaskCount: 0,
  dependencyCount: 0,
});
vi.mock("../../api/client", () => ({
  api: {
    plans: {
      list: (...args: unknown[]) => mockPlansList(...args),
      get: (...args: unknown[]) => mockPlansGet(...args),
      create: (...args: unknown[]) => mockPlansCreate(...args),
      update: (...args: unknown[]) => mockPlansUpdate(...args),
      archive: (...args: unknown[]) => mockArchive(...args),
      getCrossEpicDependencies: (...args: unknown[]) => mockGetCrossEpicDependencies(...args),
      execute: (...args: unknown[]) => mockExecute(...args),
      reExecute: (...args: unknown[]) => mockReExecute(...args),
      generate: (...args: unknown[]) => mockGenerate(...args),
    },
    tasks: { list: vi.fn().mockResolvedValue([]) },
    chat: {
      history: vi.fn().mockResolvedValue({ messages: [] }),
      send: (...args: unknown[]) => mockChatSend(...args),
    },
  },
}));

const basePlan = {
  metadata: {
    planId: "archive-test-feature",
    beadEpicId: "epic-1",
    gateTaskId: "epic-1.0",
    complexity: "medium" as const,
  },
  content: "# Archive Test\n\nContent.",
  status: "building" as const,
  taskCount: 2,
  doneTaskCount: 0,
  dependencyCount: 0,
};

function createStore(plansOverride?: (typeof basePlan)[], planError?: string | null) {
  const plans = plansOverride ?? [basePlan];

  return configureStore({
    reducer: {
      project: projectReducer,
      plan: planReducer,
      execute: executeReducer,
      notification: notificationReducer,
    },
    preloadedState: {
      plan: {
        plans,
        dependencyGraph: null,
        selectedPlanId: "archive-test-feature",
        chatMessages: {},
        loading: false,
        decomposing: false,
        generating: false,
        planStatus: null,
        executingPlanId: null,
        reExecutingPlanId: null,
        archivingPlanId: null,
        error: planError ?? null,
        backgroundError: null,
      },
      execute: {
        tasks: [
          {
            id: "epic-1.1",
            title: "Task A",
            epicId: "epic-1",
            kanbanColumn: "ready" as const,
            priority: 0,
            assignee: null,
          },
          {
            id: "epic-1.2",
            title: "Task B",
            epicId: "epic-1",
            kanbanColumn: "ready" as const,
            priority: 1,
            assignee: null,
          },
        ],
        plans: [],
        orchestratorRunning: false,
        awaitingApproval: false,
        currentTaskId: null,
        currentPhase: null,
        selectedTaskId: null,
        taskDetail: null,
        taskDetailLoading: false,
        taskDetailError: null,
        agentOutput: [],
        completionState: null,
        archivedSessions: [],
        archivedLoading: false,
        markDoneLoading: false,
        unblockLoading: false,
        statusLoading: false,
        loading: false,
        error: null,
      },
    },
  });
}

describe("PlanPhase Redux integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders compact epic cards with progress bar and nested subtasks", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    expect(screen.getByRole("progressbar", { name: /tasks done/i })).toBeInTheDocument();
    expect(screen.getAllByText("Task A").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Task B").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/0\/2/)).toBeInTheDocument();
  });

  it("renders plans from Redux state via useAppSelector", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    expect(screen.getByText("Archive Test Feature")).toBeInTheDocument();
    expect(screen.getByText(/archive test/i)).toBeInTheDocument();
  });

  it("displays error from Redux and allows dismiss", async () => {
    const store = createStore(undefined, "Failed to load plans");
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    expect(screen.getByText("Failed to load plans")).toBeInTheDocument();
    expect(screen.getByTestId("plan-error-banner")).toBeInTheDocument();
    const dismissBtn = screen.getByRole("button", { name: /Dismiss error/i });
    await user.click(dismissBtn);

    await waitFor(() => {
      expect(store.getState().plan.error).toBeNull();
    });
    expect(screen.queryByText("Failed to load plans")).not.toBeInTheDocument();
  });

  it("renders inline feature description textarea and Generate Plan button", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    expect(screen.getByTestId("feature-description-input")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/describe your feature idea/i)).toBeInTheDocument();
    expect(screen.getByTestId("generate-plan-button")).toBeInTheDocument();
    expect(screen.getByText("Generate Plan")).toBeInTheDocument();
  });

  it("disables Generate Plan button when feature description is empty", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const button = screen.getByTestId("generate-plan-button");
    expect(button).toBeDisabled();
  });
});

describe("PlanPhase archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders archive icon button in plan details sidebar when a plan is selected", async () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const archiveButton = screen.getByTitle("Archive plan (mark all ready/open tasks as done)");
    expect(archiveButton).toBeInTheDocument();
  });

  it("has main content area with overflow-y-auto, min-w-0, and min-h-0 for independent scroll", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );
    const mainContent = screen.getByText("Feature Plans").closest(".overflow-y-auto");
    expect(mainContent).toBeInTheDocument();
    expect(mainContent).toHaveClass("min-w-0");
    expect(mainContent).toHaveClass("min-h-0");
  });

  it("has root with flex flex-1 min-h-0 min-w-0 for proper fill and independent page/sidebar scroll", () => {
    const store = createStore();
    const { container } = render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );
    const root = container.firstElementChild;
    expect(root).toHaveClass("flex");
    expect(root).toHaveClass("flex-1");
    expect(root).toHaveClass("min-h-0");
    expect(root).toHaveClass("min-w-0");
  });

  it("renders resizable sidebar with resize handle when a plan is selected", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    expect(screen.getByRole("separator", { name: "Resize sidebar" })).toBeInTheDocument();
  });

  it("calls archive API when archive button is clicked", async () => {
    const store = createStore();
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const archiveButton = screen.getByTitle("Archive plan (mark all ready/open tasks as done)");
    await user.click(archiveButton);

    expect(mockArchive).toHaveBeenCalledWith("proj-1", "archive-test-feature");
  });
});

describe("PlanPhase inline editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders inline editable plan title and markdown in details sidebar", () => {
    const store = createStore();
    const { container } = render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    expect(screen.getByRole("textbox", { name: /title/i })).toBeInTheDocument();
    expect(container.querySelector('[data-prd-section="plan-body"]')).toBeInTheDocument();
  });

  it("does not render duplicate plan title in sidebar header", () => {
    const store = createStore();
    const { container } = render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );
    // The plan title may appear in EpicCard (h3) plus the editable input in sidebar,
    // but there should be no extra h3 inside the sidebar panel itself
    const sidebar = container.querySelector('[role="separator"]')?.closest(".relative");
    if (sidebar) {
      const sidebarH3s = sidebar.querySelectorAll("h3");
      const sidebarTitleH3 = Array.from(sidebarH3s).filter((h) =>
        h.textContent?.includes("Archive Test")
      );
      expect(sidebarTitleH3).toHaveLength(0);
    }
  });

  it("dispatches updatePlan when plan title is edited and blurred", async () => {
    const store = createStore();
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const titleInput = screen.getByRole("textbox", { name: /title/i });
    await user.clear(titleInput);
    await user.type(titleInput, "New Title");
    titleInput.blur();

    await waitFor(
      () => {
        expect(mockPlansUpdate).toHaveBeenCalledWith(
          "proj-1",
          "archive-test-feature",
          expect.objectContaining({
            content: expect.stringContaining("New Title"),
          })
        );
      },
      { timeout: 2000 }
    );
  });

  it("renders plan markdown in sidebar with no spurious blank space at top", () => {
    const store = createStore();
    const { container } = render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );
    const editorContainer = container.querySelector('[data-testid="plan-markdown-editor"]');
    expect(editorContainer).toBeInTheDocument();
    expect(editorContainer?.className).toMatch(/pt-0/);
    expect(editorContainer?.className).toContain("first-child");
  });
});

describe("PlanPhase Re-execute button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("shows Re-execute button when plan is complete and lastModified > shippedAt", () => {
    const plans = [
      {
        ...basePlan,
        status: "complete" as const,
        doneTaskCount: 2,
        metadata: {
          ...basePlan.metadata,
          shippedAt: "2026-02-16T08:00:00.000Z",
        },
        lastModified: "2026-02-16T10:00:00.000Z",
      },
    ];
    const store = createStore(plans);
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Re-execute" })).toBeInTheDocument();
  });

  it("hides Re-execute button when plan is complete but lastModified <= shippedAt", () => {
    const plans = [
      {
        ...basePlan,
        status: "complete" as const,
        doneTaskCount: 2,
        metadata: {
          ...basePlan.metadata,
          shippedAt: "2026-02-16T10:00:00.000Z",
        },
        lastModified: "2026-02-16T08:00:00.000Z",
      },
    ];
    const store = createStore(plans);
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: /re-execute/i })).not.toBeInTheDocument();
  });

  it("hides Re-execute button when plan is complete but lastModified === shippedAt (no changes after ship)", () => {
    const plans = [
      {
        ...basePlan,
        status: "complete" as const,
        doneTaskCount: 2,
        metadata: {
          ...basePlan.metadata,
          shippedAt: "2026-02-16T10:00:00.000Z",
        },
        lastModified: "2026-02-16T10:00:00.000Z",
      },
    ];
    const store = createStore(plans);
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: /re-execute/i })).not.toBeInTheDocument();
  });

  it("hides Re-execute button when plan is complete but lastModified is missing", () => {
    const plans = [
      {
        ...basePlan,
        status: "complete" as const,
        doneTaskCount: 2,
        metadata: {
          ...basePlan.metadata,
          shippedAt: "2026-02-16T08:00:00.000Z",
        },
        lastModified: undefined,
      },
    ];
    const store = createStore(plans);
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: /re-execute/i })).not.toBeInTheDocument();
  });

  it("hides Re-execute button when plan is complete but shippedAt is null", () => {
    const plans = [
      {
        ...basePlan,
        status: "complete" as const,
        doneTaskCount: 2,
        metadata: {
          ...basePlan.metadata,
          shippedAt: null,
        },
        lastModified: "2026-02-16T10:00:00.000Z",
      },
    ];
    const store = createStore(plans);
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: /re-execute/i })).not.toBeInTheDocument();
  });
});

describe("PlanPhase executePlan thunk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("dispatches executePlan thunk when Execute! is clicked (no cross-epic deps)", async () => {
    mockGetCrossEpicDependencies.mockResolvedValue({ prerequisitePlanIds: [] });
    const plans = [
      {
        ...basePlan,
        status: "planning" as const,
        metadata: { ...basePlan.metadata },
      },
    ];
    mockPlansList.mockResolvedValue({ plans, edges: [] });
    const store = createStore(plans);
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const executeBtn = await screen.findByRole("button", { name: "Execute!" });
    await user.click(executeBtn);

    await waitFor(() => {
      expect(mockGetCrossEpicDependencies).toHaveBeenCalledWith("proj-1", "archive-test-feature");
      expect(mockExecute).toHaveBeenCalledWith("proj-1", "archive-test-feature", undefined);
    });
  });

  it("shows cross-epic modal and passes prerequisites when user confirms", async () => {
    mockGetCrossEpicDependencies.mockResolvedValue({
      prerequisitePlanIds: ["user-auth", "feature-base"],
    });
    const plans = [
      {
        ...basePlan,
        status: "planning" as const,
        metadata: { ...basePlan.metadata },
      },
    ];
    mockPlansList.mockResolvedValue({ plans, edges: [] });
    const store = createStore(plans);
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const executeBtn = await screen.findByRole("button", { name: "Execute!" });
    await user.click(executeBtn);

    await waitFor(() => {
      expect(screen.getByText(/Cross-epic dependencies/)).toBeInTheDocument();
      expect(screen.getByText(/User Auth, Feature Base/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Proceed/ }));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith("proj-1", "archive-test-feature", [
        "user-auth",
        "feature-base",
      ]);
    });
  });
});

describe("PlanPhase reExecutePlan thunk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("dispatches reExecutePlan thunk when Re-execute is clicked", async () => {
    const plans = [
      {
        ...basePlan,
        status: "complete" as const,
        doneTaskCount: 2,
        metadata: {
          ...basePlan.metadata,
          shippedAt: "2026-02-16T08:00:00.000Z",
        },
        lastModified: "2026-02-16T10:00:00.000Z",
      },
    ];
    mockPlansList.mockResolvedValue({ plans, edges: [] });
    const store = createStore(plans);
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const reExecuteBtn = await screen.findByRole("button", { name: "Re-execute" });
    await user.click(reExecuteBtn);

    await waitFor(() => {
      expect(mockReExecute).toHaveBeenCalledWith("proj-1", "archive-test-feature");
    });
  });
});

describe("PlanPhase plan sorting and status filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("sorts plans by status order: planning, building, complete", () => {
    const plans = [
      {
        ...basePlan,
        metadata: { ...basePlan.metadata, planId: "done-feature" },
        status: "complete" as const,
      },
      {
        ...basePlan,
        metadata: { ...basePlan.metadata, planId: "planning-feature" },
        status: "planning" as const,
      },
      {
        ...basePlan,
        metadata: { ...basePlan.metadata, planId: "building-feature" },
        status: "building" as const,
      },
    ];
    const store = createStore(plans);
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const planningCard = screen.getByText("Planning Feature").closest('[role="button"]');
    const buildingCard = screen.getByText("Building Feature").closest('[role="button"]');
    const doneCard = screen.getByText("Done Feature").closest('[role="button"]');
    expect(planningCard).toBeInTheDocument();
    expect(buildingCard).toBeInTheDocument();
    expect(doneCard).toBeInTheDocument();

    const order = [planningCard!, buildingCard!, doneCard!];
    for (let i = 0; i < order.length - 1; i++) {
      const pos = order[i].compareDocumentPosition(order[i + 1]);
      expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it("renders status filter dropdown when plans exist", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const filter = screen.getByRole("combobox", { name: /filter plans by status/i });
    expect(filter).toBeInTheDocument();
    expect(filter).toHaveValue("all");
  });

  it("filters plans when status filter is changed", async () => {
    const plans = [
      {
        ...basePlan,
        metadata: { ...basePlan.metadata, planId: "planning-feature" },
        status: "planning" as const,
      },
      {
        ...basePlan,
        metadata: { ...basePlan.metadata, planId: "building-feature" },
        status: "building" as const,
      },
    ];
    const store = createStore(plans);
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    expect(screen.getByText(/planning feature/i)).toBeInTheDocument();
    expect(screen.getByText(/building feature/i)).toBeInTheDocument();

    const filter = screen.getByRole("combobox", { name: /filter plans by status/i });
    await user.selectOptions(filter, "planning");

    expect(screen.getByText(/planning feature/i)).toBeInTheDocument();
    expect(screen.queryByText(/building feature/i)).not.toBeInTheDocument();
  });

  it("shows empty message when filter has no matches", async () => {
    const plans = [
      {
        ...basePlan,
        metadata: { ...basePlan.metadata, planId: "planning-feature" },
        status: "planning" as const,
      },
    ];
    const store = createStore(plans);
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const filter = screen.getByRole("combobox", { name: /filter plans by status/i });
    await user.selectOptions(filter, "complete");

    expect(screen.getByText(/no plans match/i)).toBeInTheDocument();
  });
});

describe("PlanPhase sendPlanMessage thunk", () => {
  const storage: Record<string, string> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Object.keys(storage).forEach((k) => delete storage[k]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
      clear: () => {
        Object.keys(storage).forEach((k) => delete storage[k]);
      },
      length: 0,
      key: () => null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders Dependency Graph as collapsible container with expand/collapse toggle", async () => {
    const store = createStore();
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const header = screen.getByRole("button", { name: /dependency graph/i });
    expect(header).toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "true");

    // Content visible when expanded
    const content = document.getElementById("dependency-graph-content");
    expect(content).toBeInTheDocument();

    // Click to collapse
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("dependency-graph-content")).toBeNull();

    // Click to expand again
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("dependency-graph-content")).toBeInTheDocument();
  });

  it("persists dependency graph expanded state to localStorage", async () => {
    const store = createStore();
    const user = userEvent.setup();

    // Default: no stored value → expanded (true)
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );
    const header = screen.getByRole("button", { name: /dependency graph/i });
    expect(header).toHaveAttribute("aria-expanded", "true");

    // Collapse → persists "false"
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(storage[DEPENDENCY_GRAPH_EXPANDED_KEY]).toBe("false");

    // Expand → persists "true"
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(storage[DEPENDENCY_GRAPH_EXPANDED_KEY]).toBe("true");
  });

  it("restores dependency graph expanded state from localStorage on mount", async () => {
    storage[DEPENDENCY_GRAPH_EXPANDED_KEY] = "false";

    const store = createStore();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const header = screen.getByRole("button", { name: /dependency graph/i });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("dependency-graph-content")).toBeNull();
  });

  it("dispatches sendPlanMessage thunk when chat message is sent", async () => {
    const store = createStore();
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const chatInput = screen.getByPlaceholderText(/refine this plan/i);
    await user.type(chatInput, "Add more detail to the auth section");
    const sendButton = screen.getByRole("button", { name: /send/i });
    await user.click(sendButton);

    expect(mockChatSend).toHaveBeenCalledWith(
      "proj-1",
      "Add more detail to the auth section",
      "plan:archive-test-feature"
    );
  });
});

describe("PlanPhase Generate Plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("enables Generate Plan button when user types a description", async () => {
    const store = createStore();
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const textarea = screen.getByTestId("feature-description-input");
    const button = screen.getByTestId("generate-plan-button");

    expect(button).toBeDisabled();
    await user.type(textarea, "A user authentication feature");
    expect(button).not.toBeDisabled();
  });

  it("keeps Generate Plan button disabled for whitespace-only input", async () => {
    const store = createStore();
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const textarea = screen.getByTestId("feature-description-input");
    const button = screen.getByTestId("generate-plan-button");

    await user.type(textarea, "   ");
    expect(button).toBeDisabled();
  });

  it("calls generate API and shows toast when Generate Plan is clicked", async () => {
    const store = createStore();
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const textarea = screen.getByTestId("feature-description-input");
    await user.type(textarea, "Add dark mode support");

    const button = screen.getByTestId("generate-plan-button");
    await user.click(button);

    await waitFor(() => {
      expect(mockGenerate).toHaveBeenCalledWith("proj-1", { description: "Add dark mode support" });
    });

    const notifications = store.getState().notification.items;
    const planningToast = notifications.find(
      (n: { message: string }) => n.message === "Planning in progress"
    );
    expect(planningToast).toBeDefined();
  });

  it("clears the textarea after submitting", async () => {
    const store = createStore();
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const textarea = screen.getByTestId("feature-description-input") as HTMLTextAreaElement;
    await user.type(textarea, "Some feature");
    await user.click(screen.getByTestId("generate-plan-button"));

    expect(textarea.value).toBe("");
  });

  it("shows success notification after plan is generated", async () => {
    const store = createStore();
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    await user.type(screen.getByTestId("feature-description-input"), "Feature idea");
    await user.click(screen.getByTestId("generate-plan-button"));

    await waitFor(() => {
      const notifications = store.getState().notification.items;
      const successToast = notifications.find(
        (n: { message: string }) => n.message === "Plan generated successfully"
      );
      expect(successToast).toBeDefined();
    });
  });

  it("shows error notification when generation fails", async () => {
    mockGenerate.mockRejectedValueOnce(new Error("Agent unavailable"));
    const store = createStore();
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    await user.type(screen.getByTestId("feature-description-input"), "Feature idea");
    await user.click(screen.getByTestId("generate-plan-button"));

    await waitFor(() => {
      const notifications = store.getState().notification.items;
      const errorToast = notifications.find((n: { severity: string }) => n.severity === "error");
      expect(errorToast).toBeDefined();
    });
  });

  it("renders the generate-plan-section with correct testid", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    expect(screen.getByTestId("generate-plan-section")).toBeInTheDocument();
  });

  it("renders 'Add a Feature' label for the textarea", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    expect(screen.getByText("Add a Feature")).toBeInTheDocument();
    expect(screen.getByLabelText("Add a Feature")).toBeInTheDocument();
  });

  it("textarea accepts multi-line text", async () => {
    const store = createStore();
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const textarea = screen.getByTestId("feature-description-input") as HTMLTextAreaElement;
    await user.type(textarea, "Line 1{enter}Line 2{enter}Line 3");
    expect(textarea.value).toContain("Line 1");
    expect(textarea.value).toContain("Line 2");
    expect(textarea.value).toContain("Line 3");
  });

  it("shows 'Generating…' text on the button while generating", () => {
    const store = configureStore({
      reducer: {
        project: projectReducer,
        plan: planReducer,
        execute: executeReducer,
        notification: notificationReducer,
      },
      preloadedState: {
        plan: {
          plans: [basePlan],
          dependencyGraph: null,
          selectedPlanId: "archive-test-feature",
          chatMessages: {},
          loading: false,
          decomposing: false,
          generating: true,
          planStatus: null,
          executingPlanId: null,
          reExecutingPlanId: null,
          archivingPlanId: null,
          error: null,
          backgroundError: null,
        },
        execute: {
          tasks: [],
          plans: [],
          orchestratorRunning: false,
          awaitingApproval: false,
          currentTaskId: null,
          currentPhase: null,
          selectedTaskId: null,
          taskDetail: null,
          taskDetailLoading: false,
          taskDetailError: null,
          agentOutput: [],
          completionState: null,
          archivedSessions: [],
          archivedLoading: false,
          markDoneLoading: false,
          unblockLoading: false,
          statusLoading: false,
          loading: false,
          error: null,
        },
      },
    });

    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    expect(screen.getByText("Generating\u2026")).toBeInTheDocument();
    const textarea = screen.getByTestId("feature-description-input");
    expect(textarea).toBeDisabled();
  });

  it("does not call generate API when description is empty", async () => {
    const store = createStore();
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <PlanPhase projectId="proj-1" />
      </Provider>
    );

    const button = screen.getByTestId("generate-plan-button");
    await user.click(button);

    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
