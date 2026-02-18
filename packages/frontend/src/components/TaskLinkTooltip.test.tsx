import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TaskLinkTooltip } from "./TaskLinkTooltip";

const mockTasksGet = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    tasks: {
      get: (...args: unknown[]) => mockTasksGet(...args),
    },
  },
}));

describe("TaskLinkTooltip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders children", () => {
    render(
      <TaskLinkTooltip projectId="proj-1" taskId="task-1">
        <span data-testid="child">Ticket task-1</span>
      </TaskLinkTooltip>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.getByText("Ticket task-1")).toBeInTheDocument();
  });

  it("does not show tooltip before hover delay", () => {
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

    render(
      <TaskLinkTooltip projectId="proj-1" taskId="task-1">
        <span>Link</span>
      </TaskLinkTooltip>,
    );

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    const link = screen.getByText("Link");
    link.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    vi.advanceTimersByTime(150);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows tooltip with cached title after hover delay", async () => {
    render(
      <TaskLinkTooltip projectId="proj-1" taskId="task-1" cachedTitle="Cached task title">
        <span>Link</span>
      </TaskLinkTooltip>,
    );

    const link = screen.getByText("Link");
    link.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(250);

    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Cached task title");
    expect(mockTasksGet).not.toHaveBeenCalled();
  });

  it("fetches title via API when not cached and shows tooltip", async () => {
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

    render(
      <TaskLinkTooltip projectId="proj-1" taskId="task-1">
        <span>Link</span>
      </TaskLinkTooltip>,
    );

    const link = screen.getByText("Link");
    link.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(250);

    await waitFor(() => {
      expect(mockTasksGet).toHaveBeenCalledWith("proj-1", "task-1");
    });

    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Fix login button");
  });

  it("does not show tooltip when fetch fails (e.g. deleted ticket)", async () => {
    mockTasksGet.mockRejectedValue(new Error("Task not found"));

    render(
      <TaskLinkTooltip projectId="proj-1" taskId="deleted-task">
        <span>Link</span>
      </TaskLinkTooltip>,
    );

    const link = screen.getByText("Link");
    link.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(250);

    await waitFor(() => {
      expect(mockTasksGet).toHaveBeenCalledWith("proj-1", "deleted-task");
    });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("dismisses tooltip on mouse leave", async () => {
    render(
      <TaskLinkTooltip projectId="proj-1" taskId="task-1" cachedTitle="Cached title">
        <span>Link</span>
      </TaskLinkTooltip>,
    );

    const link = screen.getByText("Link");
    link.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(250);

    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    link.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("uses theme tokens for styling", async () => {
    render(
      <TaskLinkTooltip projectId="proj-1" taskId="task-1" cachedTitle="Title">
        <span>Link</span>
      </TaskLinkTooltip>,
    );

    const link = screen.getByText("Link");
    link.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(250);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveClass("bg-theme-bg-elevated");
    expect(tooltip).toHaveClass("text-theme-text");
    expect(tooltip).toHaveClass("ring-theme-border");
  });
});
