import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TaskLinkDisplay } from "./TaskLinkDisplay";

const mockTasksGet = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    tasks: {
      get: (...args: unknown[]) => mockTasksGet(...args),
    },
  },
}));

describe("TaskLinkDisplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders cached title when provided", () => {
    render(
      <TaskLinkDisplay projectId="proj-1" taskId="task-1" cachedTitle="Cached task title" />
    );
    expect(screen.getByText("Cached task title")).toBeInTheDocument();
    expect(mockTasksGet).not.toHaveBeenCalled();
  });

  it("truncates cached title to 30 characters with ellipsis", () => {
    const longTitle = "This is a very long task title that exceeds thirty characters";
    render(
      <TaskLinkDisplay projectId="proj-1" taskId="task-1" cachedTitle={longTitle} />
    );
    expect(screen.getByText("This is a very long task title…")).toBeInTheDocument();
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

    render(<TaskLinkDisplay projectId="proj-1" taskId="task-1" />);

    expect(screen.getByText("task-1")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Fix login button")).toBeInTheDocument();
    });

    expect(mockTasksGet).toHaveBeenCalledWith("proj-1", "task-1");
  });

  it("falls back to taskId when fetch fails", async () => {
    mockTasksGet.mockRejectedValue(new Error("Task not found"));

    render(<TaskLinkDisplay projectId="proj-1" taskId="deleted-task" />);

    await waitFor(() => {
      expect(mockTasksGet).toHaveBeenCalledWith("proj-1", "deleted-task");
    });

    expect(screen.getByText("deleted-task")).toBeInTheDocument();
  });

  it("does not truncate title under 30 characters", () => {
    render(
      <TaskLinkDisplay projectId="proj-1" taskId="task-1" cachedTitle="Short title" />
    );
    expect(screen.getByText("Short title")).toBeInTheDocument();
  });
});
