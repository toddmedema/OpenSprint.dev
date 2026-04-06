// @vitest-environment jsdom
/**
 * Backward compatibility: flat plans (no parentPlanId) should behave like a simple list
 * in PlanListView’s tree layout (`role="tree"`, `PlanTreeItem` / `buildPlanForest`) — all
 * roots, no nested sub-plan groups. There is no separate PlanTreeView component.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanListView } from "../components/plan/PlanListView";
import type { Plan } from "@opensprint/shared";

function makeFlatPlan(
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
    content: `# ${planId}\n\nBody.`,
    status,
    taskCount,
    doneTaskCount: 0,
    dependencyCount: 0,
    hasGeneratedPlanTasksForCurrentVersion,
    depth: 1,
    parentPlanId: null,
    childPlanIds: [],
  };
}

describe("planBackwardCompat (flat / single-plan UI)", () => {
  it("PlanListView still groups flat plans by status with one row per plan (unchanged queue shape)", () => {
    const plans: Plan[] = [
      makeFlatPlan("alpha-flat", "planning", 0),
      makeFlatPlan("beta-flat", "planning", 0),
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

    const section = screen.getByTestId("plan-list-section-planning");
    const tree = within(section).getByRole("tree", { name: /planning plans/i });
    expect(within(tree).getAllByTestId(/^plan-list-row-/)).toHaveLength(2);
    expect(screen.getByTestId("plan-list-row-alpha-flat")).toBeInTheDocument();
    expect(screen.getByTestId("plan-list-row-beta-flat")).toBeInTheDocument();
  });

  it("tree layout shows flat plans as root-level rows only (no nested sub-plan groups)", () => {
    const plans: Plan[] = [
      makeFlatPlan("root-a", "planning", 0),
      makeFlatPlan("root-b", "planning", 0),
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

    const section = screen.getByTestId("plan-list-section-planning");
    const tree = within(section).getByRole("tree");
    expect(within(tree).queryByRole("group")).toBeNull();
  });

  it("Generate tasks invokes the same handler for a single flat planning plan", async () => {
    const user = userEvent.setup();
    const onPlanTasks = vi.fn();
    const plans = [makeFlatPlan("solo-flat", "planning", 0)];
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
        onPlanTasks={onPlanTasks}
        onReship={vi.fn()}
        onClearError={vi.fn()}
      />
    );

    await user.click(screen.getByTestId("plan-list-generate-tasks"));
    expect(onPlanTasks).toHaveBeenCalledTimes(1);
    expect(onPlanTasks).toHaveBeenCalledWith("solo-flat");
  });
});
