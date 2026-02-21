import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { TaskLinkDisplay } from "./TaskLinkDisplay";
import taskRegistryReducer from "../store/slices/taskRegistrySlice";

const mockTasksGet = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    tasks: {
      get: (...args: unknown[]) => mockTasksGet(...args),
    },
  },
}));

function createStore(preloadedTaskRegistry?: { byProject: Record<string, Record<string, { title: string; kanbanColumn: string; priority: number }>> }) {
  return configureStore({
    reducer: { taskRegistry: taskRegistryReducer },
    preloadedState: preloadedTaskRegistry ? { taskRegistry: preloadedTaskRegistry } : undefined,
  });
}

function renderWithStore(
  ui: React.ReactElement,
  options?: { taskRegistry?: { byProject: Record<string, Record<string, { title: string; kanbanColumn: string; priority: number }>> } }
) {
  const store = createStore(options?.taskRegistry);
  return {
    ...render(<Provider store={store}>{ui}</Provider>),
    store,
  };
}

describe("TaskLinkDisplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders cached title when provided", () => {
    renderWithStore(
      <TaskLinkDisplay projectId="proj-1" taskId="task-1" cachedTitle="Cached task title" />
    );
    expect(screen.getByText("Cached task title")).toBeInTheDocument();
    expect(mockTasksGet).not.toHaveBeenCalled();
  });

  it("truncates cached title to 30 characters with ellipsis", () => {
    const longTitle = "This is a very long task title that exceeds thirty characters";
    renderWithStore(
      <TaskLinkDisplay projectId="proj-1" taskId="task-1" cachedTitle={longTitle} />
    );
    expect(screen.getByText("This is a very long task title…")).toBeInTheDocument();
  });

  it("does not call api.tasks.get when title is in taskRegistry", () => {
    renderWithStore(
      <TaskLinkDisplay projectId="proj-1" taskId="task-1" />,
      {
        taskRegistry: {
          byProject: {
            "proj-1": {
              "task-1": { title: "From registry", kanbanColumn: "backlog", priority: 1 },
            },
          },
        },
      }
    );
    expect(screen.getByText("From registry")).toBeInTheDocument();
    expect(mockTasksGet).not.toHaveBeenCalled();
  });

  it("fetches title via API and dispatches mergeTask when not in registry and no cachedTitle", async () => {
    const taskFromApi = {
      id: "task-1",
      title: "Fix login button",
      description: "",
      type: "bug",
      status: "open",
      priority: 1,
      assignee: null,
      labels: [],
      dependencies: [],
      epicId: null,
      kanbanColumn: "backlog",
      createdAt: "",
      updatedAt: "",
    };
    mockTasksGet.mockResolvedValue(taskFromApi);

    const { store } = renderWithStore(<TaskLinkDisplay projectId="proj-1" taskId="task-1" />);

    expect(screen.getByText("task-1")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Fix login button")).toBeInTheDocument();
    });

    expect(mockTasksGet).toHaveBeenCalledWith("proj-1", "task-1");

    expect(store.getState().taskRegistry.byProject["proj-1"]?.["task-1"]).toEqual({
      title: "Fix login button",
      kanbanColumn: "backlog",
      priority: 1,
    });
  });

  it("fetches title via API when not cached", async () => {
    mockTasksGet.mockResolvedValue({
      id: "task-1",
      title: "Fix login button",
      description: "",
      type: "bug",
      status: "open",
      priority: 1,
      assignee: null,
      labels: [],
      dependencies: [],
      epicId: null,
      kanbanColumn: "backlog",
      createdAt: "",
      updatedAt: "",
    });

    renderWithStore(<TaskLinkDisplay projectId="proj-1" taskId="task-1" />);

    expect(screen.getByText("task-1")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Fix login button")).toBeInTheDocument();
    });

    expect(mockTasksGet).toHaveBeenCalledWith("proj-1", "task-1");
  });

  it("falls back to taskId when fetch fails", async () => {
    mockTasksGet.mockRejectedValue(new Error("Task not found"));

    renderWithStore(<TaskLinkDisplay projectId="proj-1" taskId="deleted-task" />);

    await waitFor(() => {
      expect(mockTasksGet).toHaveBeenCalledWith("proj-1", "deleted-task");
    });

    expect(screen.getByText("deleted-task")).toBeInTheDocument();
  });

  it("does not truncate title under 30 characters", () => {
    renderWithStore(
      <TaskLinkDisplay projectId="proj-1" taskId="task-1" cachedTitle="Short title" />
    );
    expect(screen.getByText("Short title")).toBeInTheDocument();
  });
});
