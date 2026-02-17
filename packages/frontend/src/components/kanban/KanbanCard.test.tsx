import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanCard } from "./KanbanCard";

const mockTask = {
  id: "epic-1.1",
  title: "Implement login",
  description: "Add login flow",
  type: "task" as const,
  status: "open" as const,
  priority: 1,
  assignee: "agent-1",
  labels: [],
  dependencies: [],
  epicId: "epic-1",
  kanbanColumn: "in_progress" as const,
  createdAt: "",
  updatedAt: "",
};

describe("KanbanCard", () => {
  it("renders task title and id", () => {
    const onClick = vi.fn();
    render(<KanbanCard task={mockTask} onClick={onClick} />);

    expect(screen.getByText("Implement login")).toBeInTheDocument();
    expect(screen.getByText("epic-1.1")).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<KanbanCard task={mockTask} onClick={onClick} />);

    await user.click(screen.getByText("Implement login"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
