// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanTreeView } from "./PlanTreeView";
import type { Plan, PlanDependencyEdge } from "@opensprint/shared";
import { MAX_PLAN_DEPTH } from "@opensprint/shared";

function makePlan(
  planId: string,
  status: Plan["status"],
  taskCount = 0,
  hasGeneratedPlanTasksForCurrentVersion = taskCount > 0,
  opts?: { parentPlanId?: string; depth?: number; childPlanIds?: string[]; content?: string }
): Plan {
  return {
    metadata: {
      planId,
      epicId: `epic-${planId}`,
      shippedAt: null,
      complexity: "medium",
      ...(opts?.parentPlanId != null ? { parentPlanId: opts.parentPlanId } : {}),
    },
    content: opts?.content ?? "",
    status,
    taskCount,
    doneTaskCount: 0,
    dependencyCount: 0,
    hasGeneratedPlanTasksForCurrentVersion,
    ...(opts?.depth != null ? { depth: opts.depth } : {}),
    ...(opts?.childPlanIds != null ? { childPlanIds: opts.childPlanIds } : {}),
  };
}

function renderTree(
  props: Partial<ComponentProps<typeof PlanTreeView>> & {
    plans: Plan[];
    edges?: PlanDependencyEdge[];
  }
) {
  const {
    plans,
    edges = [],
    selectedPlanId = null,
    executingPlanId = null,
    reExecutingPlanId = null,
    planTasksPlanIds = [],
    executeError = null,
    onSelectPlan = vi.fn(),
    onShip = vi.fn(),
    onPlanTasks = vi.fn(),
    onReship = vi.fn(),
    onClearError = vi.fn(),
    ...rest
  } = props;
  return render(
    <PlanTreeView
      plans={plans}
      edges={edges}
      selectedPlanId={selectedPlanId}
      executingPlanId={executingPlanId}
      reExecutingPlanId={reExecutingPlanId}
      planTasksPlanIds={planTasksPlanIds}
      executeError={executeError}
      onSelectPlan={onSelectPlan}
      onShip={onShip}
      onPlanTasks={onPlanTasks}
      onReship={onReship}
      onClearError={onClearError}
      {...rest}
    />
  );
}

describe("PlanTreeView", () => {
  it("renders flat plans as sibling tree items (no nested groups)", () => {
    const plans: Plan[] = [
      makePlan("alpha", "planning", 0),
      makePlan("beta", "building", 1, true),
    ];
    renderTree({ plans });

    expect(screen.getByTestId("plan-tree-view")).toBeInTheDocument();
    const tree = screen.getByRole("tree", { name: /plan hierarchy/i });
    expect(within(tree).getAllByRole("treeitem")).toHaveLength(2);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("renders a two-level hierarchy with a sub-plans group", () => {
    const plans: Plan[] = [
      makePlan("root-plan", "planning", 0, false, { childPlanIds: ["child-plan"] }),
      makePlan("child-plan", "planning", 0, false, { parentPlanId: "root-plan", depth: 2 }),
    ];
    renderTree({ plans });

    expect(screen.getByTestId("plan-tree-row-root-plan")).toBeInTheDocument();
    expect(screen.getByTestId("plan-tree-row-child-plan")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /sub-plans under/i })).toBeInTheDocument();
  });

  it("expand/collapse hides and shows child rows", async () => {
    const user = userEvent.setup();
    const plans: Plan[] = [
      makePlan("root-plan", "planning", 0, false, { childPlanIds: ["child-plan"] }),
      makePlan("child-plan", "planning", 0, false, { parentPlanId: "root-plan" }),
    ];
    renderTree({ plans });

    const toggle = screen.getByTestId("plan-tree-toggle-root-plan");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("plan-tree-row-child-plan")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("plan-tree-row-child-plan")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByTestId("plan-tree-row-child-plan")).toBeInTheDocument();
  });

  it("at max depth shows split-unavailable messaging and keeps Generate tasks enabled", () => {
    const plans: Plan[] = [
      makePlan("deep-plan", "planning", 0, false, { depth: MAX_PLAN_DEPTH }),
    ];
    renderTree({ plans });

    expect(screen.getByTestId("plan-tree-max-depth-hint")).toHaveTextContent("Max depth");
    const split = screen.getByTestId("plan-tree-split-impossible-deep-plan");
    expect(split).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("plan-tree-generate-tasks-deep-plan")).toBeEnabled();
  });

  it("disabled state at max depth (sub-plan split unavailable; leaf task generation still allowed)", () => {
    const plans: Plan[] = [
      makePlan("leaf-at-max", "planning", 0, false, { depth: MAX_PLAN_DEPTH }),
    ];
    renderTree({ plans });
    expect(screen.getByTestId("plan-tree-max-depth-hint")).toBeInTheDocument();
    expect(screen.getByTestId("plan-tree-split-impossible-leaf-at-max")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    const gen = screen.getByTestId("plan-tree-generate-tasks-leaf-at-max");
    expect(gen).toBeEnabled();
    expect(gen).toHaveAttribute("title", expect.stringContaining("maximum depth"));
  });

  it("shows task cap as n/15 max for planning rows", () => {
    const plans = [makePlan("p1", "planning", 3, false)];
    renderTree({ plans });
    expect(screen.getByTestId("plan-tree-task-cap-p1")).toHaveTextContent("3/15 max");
  });

  it("uses first # heading as title when present", () => {
    const plans = [
      makePlan("slug-id", "planning", 0, false, {
        content: "# My Custom Title\n\nBody here.",
      }),
    ];
    renderTree({ plans });
    expect(screen.getByText("My Custom Title")).toBeInTheDocument();
  });

  it("invokes onSelectPlan when clicking a row (not action buttons)", async () => {
    const user = userEvent.setup();
    const onSelectPlan = vi.fn();
    const plans = [makePlan("click-me", "planning", 0)];
    renderTree({ plans, onSelectPlan });

    const row = screen.getByTestId("plan-tree-row-click-me");
    await user.click(within(row).getByText("Click Me"));
    expect(onSelectPlan).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ planId: "click-me" }) })
    );
  });

  it("selects plan with Enter from focused treeitem", async () => {
    const user = userEvent.setup();
    const onSelectPlan = vi.fn();
    const plans = [makePlan("k1", "planning", 0), makePlan("k2", "planning", 0)];
    renderTree({ plans, onSelectPlan });

    const items = screen.getAllByRole("treeitem");
    items[0]!.focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(onSelectPlan).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ planId: "k2" }) })
    );
  });

  it("ArrowLeft collapses an expanded parent", async () => {
    const user = userEvent.setup();
    const plans: Plan[] = [
      makePlan("root-plan", "planning", 0, false, { childPlanIds: ["child-plan"] }),
      makePlan("child-plan", "planning", 0, false, { parentPlanId: "root-plan" }),
    ];
    renderTree({ plans });

    const rootRow = screen.getByTestId("plan-tree-row-root-plan");
    rootRow.focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByTestId("plan-tree-toggle-root-plan")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("plan-tree-row-child-plan")).not.toBeInTheDocument();
  });
});
