import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddLinkFlow from "./AddLinkFlow";
import type { Task } from "@opensprint/shared";

const tasks: Task[] = [
  {
    id: "os-1.1",
    title: "Auth",
    status: "open",
    priority: 1,
    type: "task",
    issue_type: "task",
    assignee: null,
    labels: [],
    dependencies: [],
    createdAt: "",
    updatedAt: "",
    created: "",
    updated: "",
  } as Task,
  {
    id: "os-1.2",
    title: "API",
    status: "open",
    priority: 1,
    type: "task",
    issue_type: "task",
    assignee: null,
    labels: [],
    dependencies: [],
    createdAt: "",
    updatedAt: "",
    created: "",
    updated: "",
  } as Task,
  {
    id: "os-1.3",
    title: "UI polish",
    status: "open",
    priority: 1,
    type: "task",
    issue_type: "task",
    assignee: null,
    labels: [],
    dependencies: [],
    createdAt: "",
    updatedAt: "",
    created: "",
    updated: "",
  } as Task,
];

describe("AddLinkFlow", () => {
  const onSave = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters out self and excluded tasks from suggestions", async () => {
    const user = userEvent.setup();
    render(
      <AddLinkFlow
        projectId="proj-1"
        childTaskId="os-1.1"
        tasks={tasks}
        excludeIds={new Set(["os-1.2"])}
        onSave={onSave}
        onCancel={onCancel}
      />
    );

    await user.type(screen.getByTestId("add-link-input"), "os-1");

    expect(screen.getByTestId("add-link-suggestions")).toBeInTheDocument();
    expect(screen.queryByText("Auth")).not.toBeInTheDocument();
    expect(screen.queryByText("API")).not.toBeInTheDocument();
    expect(screen.getByText("UI polish")).toBeInTheDocument();
  });

  it("selects the highlighted suggestion with keyboard navigation", async () => {
    const user = userEvent.setup();
    onSave.mockResolvedValue(undefined);
    render(
      <AddLinkFlow
        projectId="proj-1"
        childTaskId="os-1.1"
        tasks={tasks}
        onSave={onSave}
        onCancel={onCancel}
      />
    );

    const input = screen.getByTestId("add-link-input");
    await user.type(input, "os-1");
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("os-1.3", "blocks");
    });
    expect(onCancel).toHaveBeenCalled();
  });

  it("accepts manual task ID entry and selected link type", async () => {
    const user = userEvent.setup();
    onSave.mockResolvedValue(undefined);
    render(
      <AddLinkFlow
        projectId="proj-1"
        childTaskId="os-1.1"
        tasks={tasks}
        onSave={onSave}
        onCancel={onCancel}
      />
    );

    await user.selectOptions(screen.getByTestId("add-link-type-select"), "related");
    await user.type(screen.getByTestId("add-link-input"), "external-task");
    await user.click(screen.getByTestId("add-link-save-btn"));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("external-task", "related");
    });
  });

  it("rejects duplicate or self links", async () => {
    const user = userEvent.setup();
    render(
      <AddLinkFlow
        projectId="proj-1"
        childTaskId="os-1.1"
        tasks={tasks}
        onSave={onSave}
        onCancel={onCancel}
      />
    );

    await user.type(screen.getByTestId("add-link-input"), "os-1.1");
    await user.click(screen.getByTestId("add-link-save-btn"));

    expect(screen.getByTestId("add-link-error")).toHaveTextContent("Cannot link to this task");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows save errors and lets cancel dismiss the flow", async () => {
    const user = userEvent.setup();
    onSave.mockRejectedValue(new Error("Save failed"));
    render(
      <AddLinkFlow
        projectId="proj-1"
        childTaskId="os-1.1"
        tasks={tasks}
        onSave={onSave}
        onCancel={onCancel}
      />
    );

    await user.type(screen.getByTestId("add-link-input"), "os-1.3");
    await user.click(screen.getByTestId("add-link-save-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("add-link-error")).toHaveTextContent("Save failed");
    });

    await user.click(screen.getByTestId("add-link-cancel-btn"));
    expect(onCancel).toHaveBeenCalled();
  });
});
