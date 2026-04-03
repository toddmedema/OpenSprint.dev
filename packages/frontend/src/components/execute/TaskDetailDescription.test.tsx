import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskDetailDescription } from "./TaskDetailDescription";

describe("TaskDetailDescription", () => {
  it("uses the same CollapsibleSection content padding as Execution diagnostics and Live agent output", () => {
    const { container } = render(
      <TaskDetailDescription
        content="Hello **world**"
        expanded={true}
        onToggle={vi.fn()}
      />
    );

    const region = container.querySelector("#description-content");
    expect(region).toBeInTheDocument();
    expect(region).toHaveClass("p-4", "pt-0");
  });

  it("renders markdown when expanded", () => {
    render(
      <TaskDetailDescription content="Line one" expanded={true} onToggle={vi.fn()} />
    );
    expect(screen.getByTestId("task-description-markdown")).toHaveTextContent("Line one");
  });

  it("hides markdown region when collapsed", () => {
    render(
      <TaskDetailDescription content="Hidden" expanded={false} onToggle={vi.fn()} />
    );
    expect(screen.queryByTestId("task-description-markdown")).not.toBeInTheDocument();
  });

  it("calls onToggle when header is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <TaskDetailDescription content="x" expanded={true} onToggle={onToggle} />
    );
    await user.click(screen.getByRole("button", { name: /collapse description/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
