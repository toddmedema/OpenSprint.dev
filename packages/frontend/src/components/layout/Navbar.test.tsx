import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import type { Task } from "@opensprint/shared";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { Navbar } from "./Navbar";
import executeReducer from "../../store/slices/executeSlice";
import planReducer from "../../store/slices/planSlice";
import websocketReducer from "../../store/slices/websocketSlice";

const mockGetSettings = vi.fn();
vi.mock("../../api/client", () => ({
  api: {
    projects: {
      list: vi.fn().mockResolvedValue([]),
      getSettings: (...args: unknown[]) => mockGetSettings(...args),
    },
    agents: { active: vi.fn().mockResolvedValue([]) },
    env: { getKeys: vi.fn().mockResolvedValue({ anthropic: true, cursor: true, claudeCli: true }) },
  },
}));

const storage: Record<string, string> = {};
beforeEach(() => {
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
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
  Object.keys(storage).forEach((k) => delete storage[k]);
});

function renderNavbar(ui: ReactElement, store = createStore()) {
  return render(
    <ThemeProvider>
      <Provider store={store}>
        <MemoryRouter>{ui}</MemoryRouter>
      </Provider>
    </ThemeProvider>
  );
}

function createStore(executeTasks: Task[] = []) {
  return configureStore({
    reducer: {
      execute: executeReducer,
      plan: planReducer,
      websocket: websocketReducer,
    },
    preloadedState: {
      execute: {
        tasks: executeTasks,
        plans: [],
        awaitingApproval: false,
        orchestratorRunning: false,
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
      },
      plan: {
        plans: [],
        dependencyGraph: null,
        selectedPlanId: null,
        chatMessages: {},
        loading: false,
        decomposing: false,
        executingPlanId: null,
        reExecutingPlanId: null,
        archivingPlanId: null,
        error: null,
      },
      websocket: { connected: false, hilRequest: null, hilNotification: null, deliverToast: null },
    },
  });
}

const baseTask: Partial<Task> = {
  title: "Task",
  description: "",
  type: "task",
  status: "open",
  priority: 0,
  assignee: null,
  labels: [],
  dependencies: [],
  epicId: "epic-1",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("Navbar", () => {
  it("has z-[60] so dropdowns appear above Build sidebar (z-50)", () => {
    renderNavbar(<Navbar project={null} />);

    const nav = screen.getByRole("navigation");
    expect(nav).toHaveClass("z-[60]");
  });

  it("does not render theme toggle in navbar", () => {
    renderNavbar(<Navbar project={null} />);

    expect(screen.queryByTestId("navbar-theme-light")).not.toBeInTheDocument();
    expect(screen.queryByTestId("navbar-theme-dark")).not.toBeInTheDocument();
    expect(screen.queryByTestId("navbar-theme-system")).not.toBeInTheDocument();
  });

  it("shows Execute tab label when no blocked tasks", () => {
    const mockProject = {
      id: "proj-1",
      name: "Test",
      repoPath: "/path",
      currentPhase: "sketch" as const,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    };
    const store = createStore([{ ...baseTask, id: "epic-1.1", kanbanColumn: "ready" } as Task]);
    const onPhaseChange = vi.fn();
    renderNavbar(
      <Navbar project={mockProject} currentPhase="sketch" onPhaseChange={onPhaseChange} />,
      store
    );

    expect(screen.getByRole("button", { name: "Execute" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "⚠️ Execute" })).not.toBeInTheDocument();
  });

  it("shows ⚠️ Execute badge in phase nav when blocked task count > 0", () => {
    const mockProject = {
      id: "proj-1",
      name: "Test",
      repoPath: "/path",
      currentPhase: "sketch" as const,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    };
    const store = createStore([{ ...baseTask, id: "epic-1.1", kanbanColumn: "blocked" } as Task]);
    const onPhaseChange = vi.fn();
    renderNavbar(
      <Navbar project={mockProject} currentPhase="sketch" onPhaseChange={onPhaseChange} />,
      store
    );

    expect(screen.getByRole("button", { name: "⚠️ Execute" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Execute" })).not.toBeInTheDocument();
  });

  it("shows Execute (no badge) when blocked count returns to zero", () => {
    const mockProject = {
      id: "proj-1",
      name: "Test",
      repoPath: "/path",
      currentPhase: "sketch" as const,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    };
    const store = createStore([{ ...baseTask, id: "epic-1.1", kanbanColumn: "ready" } as Task]);
    const onPhaseChange = vi.fn();
    renderNavbar(
      <Navbar project={mockProject} currentPhase="execute" onPhaseChange={onPhaseChange} />,
      store
    );

    expect(screen.getByRole("button", { name: "Execute" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "⚠️ Execute" })).not.toBeInTheDocument();
  });

  it("theme is configurable from project settings Display section", async () => {
    const user = userEvent.setup();
    const mockProject = {
      id: "proj-1",
      name: "Test",
      repoPath: "/path",
      currentPhase: "sketch" as const,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    };
    mockGetSettings.mockResolvedValue({
      planningAgent: { type: "claude", model: "claude-3-5-sonnet", cliCommand: null },
      codingAgent: { type: "claude", model: "claude-3-5-sonnet", cliCommand: null },
      deployment: { mode: "custom" },
      hilConfig: {
        scopeChanges: "requires_approval",
        architectureDecisions: "requires_approval",
        dependencyModifications: "requires_approval",
      },
    });

    const onSettingsOpenChange = vi.fn();
    renderNavbar(
      <Navbar
        project={mockProject}
        settingsOpen={true}
        onSettingsOpenChange={onSettingsOpenChange}
      />
    );

    await screen.findByText("Project Settings");
    const displayTab = screen.getByRole("button", { name: "Display" });
    await user.click(displayTab);

    await user.click(screen.getByTestId("theme-option-dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("opensprint.theme")).toBe("dark");
  });
});
