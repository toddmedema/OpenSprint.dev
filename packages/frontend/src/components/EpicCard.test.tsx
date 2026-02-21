import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EpicCard } from "./EpicCard";
import type { Plan, Task } from "@opensprint/shared";

const basePlan: Plan = {
  metadata: {
    planId: "auth-feature",
    beadEpicId: "epic-1",
    gateTaskId: "epic-1.0",
    shippedAt: null,
    complexity: "medium",
  },
  content: "# Auth Feature\n\nContent.",
  status: "building",
  taskCount: 3,
  doneTaskCount: 1,
  dependencyCount: 0,
};

const tasks: Task[] = [
  {
    id: "epic-1.1",
    title: "Implement login",
    description: "",
    type: "task",
    status: "closed",
    priority: 0,
    assignee: null,
    labels: [],
    dependencies: [],
    epicId: "epic-1",
    kanbanColumn: "done",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "epic-1.2",
    title: "Implement logout",
    description: "",
    type: "task",
    status: "open",
    priority: 1,
    assignee: null,
    labels: [],
    dependencies: [],
    epicId: "epic-1",
    kanbanColumn: "ready",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "epic-1.3",
    title: "Add session timeout",
    description: "",
    type: "task",
    status: "open",
    priority: 2,
    assignee: null,
    labels: [],
    dependencies: [],
    epicId: "epic-1",
    kanbanColumn: "backlog",
    createdAt: "",
    updatedAt: "",
  },
];

describe("EpicCard", () => {
  it("renders plan title and status", () => {
    const onSelect = vi.fn();
    render(
      <EpicCard
        plan={basePlan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        onSelect={onSelect}
        onShip={vi.fn()}
        onReship={vi.fn()}
      />
    );

    expect(screen.getByText("Auth Feature")).toBeInTheDocument();
    expect(screen.getByText("building")).toBeInTheDocument();
  });

  it("renders progress bar with correct completion", () => {
    render(
      <EpicCard
        plan={basePlan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
      />
    );

    const progressbar = screen.getByRole("progressbar", {
      name: "1 of 3 tasks done",
    });
    expect(progressbar).toBeInTheDocument();
    expect(progressbar).toHaveAttribute("aria-valuenow", "1");
    expect(progressbar).toHaveAttribute("aria-valuemax", "3");
  });

  it("renders done count text", () => {
    render(
      <EpicCard
        plan={basePlan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
      />
    );

    expect(screen.getByText(/1\/3/)).toBeInTheDocument();
  });

  it("renders nested subtasks with status indicators", () => {
    render(
      <EpicCard
        plan={basePlan}
        tasks={tasks}
        executingPlanId={null}
        reExecutingPlanId={null}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
      />
    );

    expect(screen.getByText("Implement login")).toBeInTheDocument();
    expect(screen.getByText("Implement logout")).toBeInTheDocument();
    expect(screen.getByText("Add session timeout")).toBeInTheDocument();
  });

  it("calls onSelect when card is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <EpicCard
        plan={basePlan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        onSelect={onSelect}
        onShip={vi.fn()}
        onReship={vi.fn()}
      />
    );

    await user.click(screen.getByText("Auth Feature"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows Execute! button when plan status is planning", () => {
    const plan: Plan = { ...basePlan, status: "planning" };
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
      />
    );

    const executeButtons = screen.getAllByRole("button", { name: /execute!/i });
    expect(executeButtons.find((b) => b.tagName === "BUTTON")).toBeInTheDocument();
  });

  it("calls onShip when Execute! is clicked", async () => {
    const onShip = vi.fn();
    const user = userEvent.setup();
    const plan: Plan = { ...basePlan, status: "planning" };
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        onSelect={vi.fn()}
        onShip={onShip}
        onReship={vi.fn()}
      />
    );

    const shipButtons = screen.getAllByRole("button", { name: /execute!/i });
    await user.click(shipButtons.find((b) => b.tagName === "BUTTON")!);
    expect(onShip).toHaveBeenCalledTimes(1);
  });

  it("shows Re-execute button when plan is complete and modified after ship", () => {
    const plan: Plan = {
      ...basePlan,
      status: "complete",
      doneTaskCount: 3,
      metadata: {
        ...basePlan.metadata,
        shippedAt: "2026-02-16T08:00:00.000Z",
      },
      lastModified: "2026-02-16T10:00:00.000Z",
    };
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
      />
    );

    const reexecButtons = screen.getAllByRole("button", { name: /re-execute/i });
    expect(reexecButtons.find((b) => b.tagName === "BUTTON")).toBeInTheDocument();
  });

  it("calls onReship when Re-execute is clicked", async () => {
    const onReship = vi.fn();
    const user = userEvent.setup();
    const plan: Plan = {
      ...basePlan,
      status: "complete",
      doneTaskCount: 3,
      metadata: {
        ...basePlan.metadata,
        shippedAt: "2026-02-16T08:00:00.000Z",
      },
      lastModified: "2026-02-16T10:00:00.000Z",
    };
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={onReship}
      />
    );

    const reshipButtons = screen.getAllByRole("button", { name: /re-execute/i });
    await user.click(reshipButtons.find((b) => b.tagName === "BUTTON")!);
    expect(onReship).toHaveBeenCalledTimes(1);
  });

  it("renders Progress label and percentage when tasks exist", () => {
    render(
      <EpicCard
        plan={basePlan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
      />
    );

    expect(screen.getByText("Progress")).toBeInTheDocument();
    expect(screen.getByText(/33%/)).toBeInTheDocument();
  });

  it("formats plan title with capitalized words", () => {
    const plan: Plan = {
      ...basePlan,
      metadata: { ...basePlan.metadata, planId: "my-cool-feature" },
    };
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
      />
    );

    expect(screen.getByText("My Cool Feature")).toBeInTheDocument();
  });

  it("handles zero task count without error", () => {
    const plan: Plan = { ...basePlan, taskCount: 0, doneTaskCount: 0 };
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
      />
    );

    expect(screen.getByText("Auth Feature")).toBeInTheDocument();
    expect(screen.getByText(/0\/0/)).toBeInTheDocument();
  });

  it("shows spinner inside Execute! button when plan is executing", () => {
    const plan: Plan = { ...basePlan, status: "planning" };
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId="auth-feature"
        reExecutingPlanId={null}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
      />
    );

    expect(screen.getByTestId("execute-spinner")).toBeInTheDocument();
    expect(screen.getByText("Executing…")).toBeInTheDocument();
  });

  it("does not show spinner when a different plan is executing", () => {
    const plan: Plan = { ...basePlan, status: "planning" };
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId="other-plan"
        reExecutingPlanId={null}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
      />
    );

    expect(screen.queryByTestId("execute-spinner")).not.toBeInTheDocument();
    expect(screen.getByText("Execute!")).toBeInTheDocument();
  });

  it("disables Execute! button when any plan is executing", () => {
    const plan: Plan = { ...basePlan, status: "planning" };
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId="other-plan"
        reExecutingPlanId={null}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
      />
    );

    const btn = screen.getByTestId("execute-button");
    expect(btn).toBeDisabled();
  });

  it("shows inline error when executeError matches this plan", () => {
    const plan: Plan = { ...basePlan, status: "planning" };
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        executeError={{ planId: "auth-feature", message: "Network timeout" }}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
        onClearError={vi.fn()}
      />
    );

    expect(screen.getByTestId("execute-error-inline")).toBeInTheDocument();
    expect(screen.getByText("Network timeout")).toBeInTheDocument();
  });

  it("does not show inline error when executeError is for a different plan", () => {
    const plan: Plan = { ...basePlan, status: "planning" };
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        executeError={{ planId: "other-plan", message: "Network timeout" }}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
        onClearError={vi.fn()}
      />
    );

    expect(screen.queryByTestId("execute-error-inline")).not.toBeInTheDocument();
  });

  it("calls onClearError when inline error dismiss button is clicked", async () => {
    const onClearError = vi.fn();
    const user = userEvent.setup();
    const plan: Plan = { ...basePlan, status: "planning" };
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        executeError={{ planId: "auth-feature", message: "Network timeout" }}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
        onClearError={onClearError}
      />
    );

    const dismissBtn = screen.getByRole("button", { name: /dismiss execute error/i });
    await user.click(dismissBtn);
    expect(onClearError).toHaveBeenCalledTimes(1);
  });

  it("does not show inline error when executeError is null", () => {
    const plan: Plan = { ...basePlan, status: "planning" };
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        executeError={null}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
      />
    );

    expect(screen.queryByTestId("execute-error-inline")).not.toBeInTheDocument();
  });

  it("Execute! button is enabled when no plan is executing and no error", () => {
    const plan: Plan = { ...basePlan, status: "planning" };
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
      />
    );

    const btn = screen.getByTestId("execute-button");
    expect(btn).not.toBeDisabled();
  });

  it("shows guidance instead of Execute! when plan has no gating task", () => {
    const plan: Plan = {
      ...basePlan,
      status: "planning",
      metadata: { ...basePlan.metadata, gateTaskId: "", beadEpicId: "" },
    };
    const onShip = vi.fn();
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        onSelect={vi.fn()}
        onShip={onShip}
        onReship={vi.fn()}
      />
    );

    expect(screen.getByTestId("execute-no-gate-guidance")).toBeInTheDocument();
    expect(screen.getByText(/Generate tasks first/)).toBeInTheDocument();
    expect(screen.queryByTestId("execute-button")).not.toBeInTheDocument();
  });

  it("does not call onShip when plan has no gate (no button to click)", () => {
    const plan: Plan = {
      ...basePlan,
      status: "planning",
      metadata: { ...basePlan.metadata, gateTaskId: "" },
    };
    const onShip = vi.fn();
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        onSelect={vi.fn()}
        onShip={onShip}
        onReship={vi.fn()}
      />
    );

    expect(onShip).not.toHaveBeenCalled();
    expect(screen.queryByTestId("execute-button")).not.toBeInTheDocument();
  });

  it("shows friendly message when executeError contains no gating task", () => {
    const plan: Plan = { ...basePlan, status: "planning" };
    render(
      <EpicCard
        plan={plan}
        tasks={[]}
        executingPlanId={null}
        reExecutingPlanId={null}
        executeError={{
          planId: "auth-feature",
          message: "Plan has no gating task to close",
        }}
        onSelect={vi.fn()}
        onShip={vi.fn()}
        onReship={vi.fn()}
        onClearError={vi.fn()}
      />
    );

    expect(screen.getByTestId("execute-error-inline")).toBeInTheDocument();
    expect(
      screen.getByText(/Generate tasks first. Use the AI chat to refine this plan and add tasks/)
    ).toBeInTheDocument();
  });
});
