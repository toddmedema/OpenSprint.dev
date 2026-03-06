import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssigneeSelector } from "./AssigneeSelector";

const mockUpdateTask = vi.fn();
vi.mock("../../api/client", () => ({
  api: {
    tasks: {
      updateTask: (...args: unknown[]) => mockUpdateTask(...args),
    },
  },
}));

const defaultProps = {
  projectId: "proj-1",
  taskId: "task-1",
  currentAssignee: null,
  teamMembers: [
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
  ],
  onSelect: vi.fn(),
};

describe("AssigneeSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateTask.mockResolvedValue({});
  });

  it("renders", () => {
    render(<AssigneeSelector {...defaultProps} />);

    expect(screen.getByTestId("assignee-dropdown-trigger")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows current assignee when set", () => {
    render(<AssigneeSelector {...defaultProps} currentAssignee="Alice" />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("selecting Unassigned clears assignee", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <AssigneeSelector
        {...defaultProps}
        currentAssignee="Alice"
        onSelect={onSelect}
      />
    );

    await user.click(screen.getByTestId("assignee-dropdown-trigger"));
    expect(screen.getByTestId("assignee-dropdown")).toBeInTheDocument();

    await user.click(screen.getByTestId("assignee-option-unassigned"));

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith("proj-1", "task-1", {
        assignee: null,
      });
    });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("selecting team member sets assignee", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AssigneeSelector {...defaultProps} onSelect={onSelect} />);

    await user.click(screen.getByTestId("assignee-dropdown-trigger"));
    await user.click(screen.getByTestId("assignee-option-alice"));

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith("proj-1", "task-1", {
        assignee: "Alice",
      });
    });
    expect(onSelect).toHaveBeenCalledWith("Alice");
  });

  it("free-form Other input sets assignee", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AssigneeSelector {...defaultProps} onSelect={onSelect} />);

    await user.click(screen.getByTestId("assignee-dropdown-trigger"));
    await user.click(screen.getByTestId("assignee-option-other"));

    expect(screen.getByTestId("assignee-other-input")).toBeInTheDocument();

    await user.type(screen.getByTestId("assignee-other-input"), "Carol");
    await user.click(screen.getByTestId("assignee-other-submit"));

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith("proj-1", "task-1", {
        assignee: "Carol",
      });
    });
    expect(onSelect).toHaveBeenCalledWith("Carol");
  });

  it("readOnly shows assignee without dropdown", () => {
    render(
      <AssigneeSelector
        {...defaultProps}
        currentAssignee="Alice"
        readOnly
      />
    );

    expect(screen.getByTestId("assignee-read-only")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByTestId("assignee-dropdown-trigger")).not.toBeInTheDocument();
  });

  it("shows person icon for human assignee", () => {
    render(<AssigneeSelector {...defaultProps} currentAssignee="Alice" />);

    expect(screen.getByTestId("assignee-dropdown-trigger")).toBeInTheDocument();
    const svgs = screen.getByTestId("assignee-dropdown-trigger").querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
  });

  it("shows agent icon when isAgentAssignee is true", () => {
    render(
      <AssigneeSelector
        {...defaultProps}
        currentAssignee="Frodo"
        isAgentAssignee={true}
      />
    );

    expect(screen.getByTestId("assignee-dropdown-trigger")).toBeInTheDocument();
  });
});
