// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PlanListView } from "./PlanListView";
import type { Plan } from "@opensprint/shared";

function makePlan(
  planId: string,
  status: Plan["status"],
  taskCount = 0,
  hasGeneratedPlanTasksForCurrentVersion = taskCount > 0
): Plan {
  return {
    metadata: {
      planId,
      epicId: `epic-${planId}`,
      shippedAt: null,
      complexity: "medium",
    },
    content: "",
    status,
    taskCount,
    doneTaskCount: 0,
    dependencyCount: 0,
    hasGeneratedPlanTasksForCurrentVersion,
  };
}

describe("PlanListView", () => {
  it("groups plans by status with section headers and renders row actions on the right", () => {
    const plans: Plan[] = [
      makePlan("done-feature", "complete"),
      makePlan("planning-feature", "planning", 0),
      makePlan("in-review-feature", "in_review", 2),
      makePlan("building-feature", "building", 1),
    ];
    render(
      <PlanListView
        plans={plans}
        selectedPlanId={null}
        executingPlanId={null}
        reExecutingPlanId={null}
        planTasksPlanIds={[]}
        executeError={null}
        onSelectPlan={vi.fn()}
        onShip={vi.fn()}
        onPlanTasks={vi.fn()}
        onReship={vi.fn()}
        onClearError={vi.fn()}
      />
    );

    expect(screen.getByTestId("plan-list-view")).toBeInTheDocument();
    expect(screen.getByTestId("plan-list-section-planning")).toBeInTheDocument();
    expect(screen.getByTestId("plan-list-section-building")).toBeInTheDocument();
    expect(screen.getByTestId("plan-list-section-in_review")).toBeInTheDocument();
    expect(screen.getByTestId("plan-list-section-complete")).toBeInTheDocument();

    expect(screen.getByText("Planning")).toBeInTheDocument();
    expect(screen.getByText("Building")).toBeInTheDocument();
    expect(screen.getByText("In review")).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();

    expect(screen.getByText("Planning Feature")).toBeInTheDocument();
    expect(screen.getByText("Building Feature")).toBeInTheDocument();
    expect(screen.getByText("In Review Feature")).toBeInTheDocument();
    expect(screen.getByText("Done Feature")).toBeInTheDocument();

    const listView = screen.getByTestId("plan-list-view");
    expect(within(listView).getAllByTestId(/^plan-list-row-/)).toHaveLength(4);
  });

  it("shows Generate tasks for planning plan with zero tasks", () => {
    const plans = [makePlan("planning-feature", "planning", 0)];
    render(
      <PlanListView
        plans={plans}
        selectedPlanId={null}
        executingPlanId={null}
        reExecutingPlanId={null}
        planTasksPlanIds={[]}
        executeError={null}
        onSelectPlan={vi.fn()}
        onShip={vi.fn()}
        onPlanTasks={vi.fn()}
        onReship={vi.fn()}
        onClearError={vi.fn()}
      />
    );
    expect(screen.getByTestId("plan-list-generate-tasks")).toBeInTheDocument();
  });

  it("shows Generate tasks for planning plan with feedback-only tasks", () => {
    const plans = [makePlan("planning-feature", "planning", 1, false)];
    render(
      <PlanListView
        plans={plans}
        selectedPlanId={null}
        executingPlanId={null}
        reExecutingPlanId={null}
        planTasksPlanIds={[]}
        executeError={null}
        onSelectPlan={vi.fn()}
        onShip={vi.fn()}
        onPlanTasks={vi.fn()}
        onReship={vi.fn()}
        onClearError={vi.fn()}
      />
    );
    expect(screen.getByTestId("plan-list-generate-tasks")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-list-execute")).not.toBeInTheDocument();
  });

  it("shows Generating tasks while plan tasks are in flight", () => {
    const plans = [makePlan("planning-feature", "planning", 0)];
    render(
      <PlanListView
        plans={plans}
        selectedPlanId={null}
        executingPlanId={null}
        reExecutingPlanId={null}
        planTasksPlanIds={["planning-feature"]}
        executeError={null}
        onSelectPlan={vi.fn()}
        onShip={vi.fn()}
        onPlanTasks={vi.fn()}
        onReship={vi.fn()}
        onClearError={vi.fn()}
      />
    );
    expect(screen.getByText("Generating tasks...")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-list-generate-tasks")).not.toBeInTheDocument();
  });

  it("shows Approve and Review for in_review plan when onMarkComplete and onGoToEvaluate provided", () => {
    const plans = [makePlan("in-review-feature", "in_review", 2)];
    render(
      <PlanListView
        plans={plans}
        selectedPlanId={null}
        executingPlanId={null}
        reExecutingPlanId={null}
        planTasksPlanIds={[]}
        executeError={null}
        onSelectPlan={vi.fn()}
        onShip={vi.fn()}
        onPlanTasks={vi.fn()}
        onReship={vi.fn()}
        onClearError={vi.fn()}
        onMarkComplete={vi.fn()}
        onGoToEvaluate={vi.fn()}
      />
    );
    expect(screen.getByTestId("plan-list-mark-complete")).toHaveTextContent(/Approve/);
    expect(screen.getByTestId("plan-list-go-to-evaluate")).toHaveTextContent(/Review/);
  });

  it("hides task counts for planning rows and shows them otherwise", () => {
    const plans = [
      makePlan("planning-feature", "planning", 2, false),
      makePlan("building-feature", "building", 2),
    ];
    render(
      <PlanListView
        plans={plans}
        selectedPlanId={null}
        executingPlanId={null}
        reExecutingPlanId={null}
        planTasksPlanIds={[]}
        executeError={null}
        onSelectPlan={vi.fn()}
        onShip={vi.fn()}
        onPlanTasks={vi.fn()}
        onReship={vi.fn()}
        onClearError={vi.fn()}
      />
    );

    const planningRow = screen.getByTestId("plan-list-row-planning-feature");
    const buildingRow = screen.getByTestId("plan-list-row-building-feature");

    expect(within(planningRow).queryByText("0/2 tasks")).not.toBeInTheDocument();
    expect(within(buildingRow).getByText("0/2 tasks")).toBeInTheDocument();
  });

  it("shows Planning indicator instead of Generate tasks when planner is in-flight", () => {
    const plans = [makePlan("planning-feature", "planning", 0)];
    render(
      <PlanListView
        plans={plans}
        selectedPlanId={null}
        executingPlanId={null}
        reExecutingPlanId={null}
        planTasksPlanIds={[]}
        executeError={null}
        onSelectPlan={vi.fn()}
        onShip={vi.fn()}
        onPlanTasks={vi.fn()}
        onReship={vi.fn()}
        onClearError={vi.fn()}
        getPlanGenState={() => "planning"}
      />
    );
    expect(screen.getByTestId("plan-list-planning-indicator")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-list-generate-tasks")).not.toBeInTheDocument();
  });

  it("shows Retry button instead of Generate tasks when planner is stale", () => {
    const plans = [makePlan("planning-feature", "planning", 0)];
    const onRetryPlan = vi.fn();
    render(
      <PlanListView
        plans={plans}
        selectedPlanId={null}
        executingPlanId={null}
        reExecutingPlanId={null}
        planTasksPlanIds={[]}
        executeError={null}
        onSelectPlan={vi.fn()}
        onShip={vi.fn()}
        onPlanTasks={vi.fn()}
        onReship={vi.fn()}
        onClearError={vi.fn()}
        getPlanGenState={() => "stale"}
        onRetryPlan={onRetryPlan}
      />
    );
    expect(screen.getByTestId("plan-list-retry")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-list-generate-tasks")).not.toBeInTheDocument();
    expect(screen.queryByTestId("plan-list-planning-indicator")).not.toBeInTheDocument();
  });

  it("hides Execute button when planner is in-flight", () => {
    const plans = [makePlan("planning-feature", "planning", 0, true)];
    render(
      <PlanListView
        plans={plans}
        selectedPlanId={null}
        executingPlanId={null}
        reExecutingPlanId={null}
        planTasksPlanIds={[]}
        executeError={null}
        onSelectPlan={vi.fn()}
        onShip={vi.fn()}
        onPlanTasks={vi.fn()}
        onReship={vi.fn()}
        onClearError={vi.fn()}
        getPlanGenState={() => "planning"}
      />
    );
    expect(screen.queryByTestId("plan-list-execute")).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-list-planning-indicator")).toBeInTheDocument();
  });

  it("shows Generate tasks when getPlanGenState returns ready", () => {
    const plans = [makePlan("planning-feature", "planning", 0)];
    render(
      <PlanListView
        plans={plans}
        selectedPlanId={null}
        executingPlanId={null}
        reExecutingPlanId={null}
        planTasksPlanIds={[]}
        executeError={null}
        onSelectPlan={vi.fn()}
        onShip={vi.fn()}
        onPlanTasks={vi.fn()}
        onReship={vi.fn()}
        onClearError={vi.fn()}
        getPlanGenState={() => "ready"}
      />
    );
    expect(screen.getByTestId("plan-list-generate-tasks")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-list-planning-indicator")).not.toBeInTheDocument();
    expect(screen.queryByTestId("plan-list-retry")).not.toBeInTheDocument();
  });

  it("calls onRetryPlan with plan ID when Retry is clicked", async () => {
    const plans = [makePlan("stale-plan", "planning", 0)];
    const onRetryPlan = vi.fn();
    render(
      <PlanListView
        plans={plans}
        selectedPlanId={null}
        executingPlanId={null}
        reExecutingPlanId={null}
        planTasksPlanIds={[]}
        executeError={null}
        onSelectPlan={vi.fn()}
        onShip={vi.fn()}
        onPlanTasks={vi.fn()}
        onReship={vi.fn()}
        onClearError={vi.fn()}
        getPlanGenState={() => "stale"}
        onRetryPlan={onRetryPlan}
      />
    );
    screen.getByTestId("plan-list-retry").click();
    expect(onRetryPlan).toHaveBeenCalledWith("stale-plan");
  });

  it("shows 'May be stuck' status text for stale plans", () => {
    const plans = [makePlan("stale-plan", "planning", 0)];
    render(
      <PlanListView
        plans={plans}
        selectedPlanId={null}
        executingPlanId={null}
        reExecutingPlanId={null}
        planTasksPlanIds={[]}
        executeError={null}
        onSelectPlan={vi.fn()}
        onShip={vi.fn()}
        onPlanTasks={vi.fn()}
        onReship={vi.fn()}
        onClearError={vi.fn()}
        getPlanGenState={() => "stale"}
        onRetryPlan={vi.fn()}
      />
    );
    expect(screen.getByText("May be stuck")).toBeInTheDocument();
  });

  it("shows 'Planning…' status text for in-flight plans", () => {
    const plans = [makePlan("active-plan", "planning", 0)];
    render(
      <PlanListView
        plans={plans}
        selectedPlanId={null}
        executingPlanId={null}
        reExecutingPlanId={null}
        planTasksPlanIds={[]}
        executeError={null}
        onSelectPlan={vi.fn()}
        onShip={vi.fn()}
        onPlanTasks={vi.fn()}
        onReship={vi.fn()}
        onClearError={vi.fn()}
        getPlanGenState={() => "planning"}
      />
    );
    const row = screen.getByTestId("plan-list-row-active-plan");
    expect(within(row).getByText(/Planning…/)).toBeInTheDocument();
  });
});
