import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import planReducer, { planTasksForSubtree } from "../slices/planSlice";
import executeReducer from "../slices/executeSlice";
import projectReducer from "../slices/projectSlice";
import notificationReducer from "../slices/notificationSlice";
import { planTasksListener, planTasksAffectedMultiplePlans } from "./planTasksListener";
import { planTasks, generateTasksForPlan, executePlan, reExecutePlan } from "../slices/planSlice";
import { api } from "../../api/client";
import { getQueryClient } from "../../queryClient";
import { queryKeys } from "../../api/queryKeys";
import type { Plan } from "@opensprint/shared";

vi.mock("../../api/client", () => ({
  api: {
    plans: { planTasks: vi.fn(), get: vi.fn(), execute: vi.fn(), reExecute: vi.fn() },
    tasks: { list: vi.fn() },
    execute: { status: vi.fn() },
  },
}));

vi.mock("../../queryClient", () => ({
  getQueryClient: vi.fn(),
}));

function createStore() {
  return configureStore({
    reducer: {
      plan: planReducer,
      execute: executeReducer,
      project: projectReducer,
      notification: notificationReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(planTasksListener.middleware),
  });
}

describe("planTasksListener", () => {
  const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.mocked(api.tasks.list).mockReset();
    vi.mocked(api.tasks.list).mockResolvedValue([] as never);
    vi.mocked(api.execute.status).mockReset();
    vi.mocked(api.execute.status).mockResolvedValue({
      activeTasks: [],
      queueDepth: 0,
      totalDone: 0,
      totalFailed: 0,
    } as never);
    vi.mocked(getQueryClient).mockReturnValue({
      invalidateQueries: mockInvalidateQueries,
    } as never);
    mockInvalidateQueries.mockClear();
  });

  it("dispatches fetchTasks when planTasks.fulfilled", async () => {
    const store = createStore();
    const plan = {
      metadata: {
        planId: "plan-1",
        epicId: "epic-1",
        shippedAt: null,
        complexity: "medium" as const,
      },
      content: "",
      status: "planning" as const,
      taskCount: 2,
      doneTaskCount: 0,
      dependencyCount: 0,
    };
    vi.mocked(api.plans.planTasks).mockResolvedValue(plan as never);

    await store.dispatch(planTasks({ projectId: "proj-1", planId: "plan-1" }));

    expect(api.tasks.list).toHaveBeenCalledWith("proj-1");
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });

  it("dispatches fetchTasks when generateTasksForPlan.fulfilled", async () => {
    const store = createStore();
    const plan = {
      metadata: {
        planId: "plan-2",
        epicId: "epic-2",
        shippedAt: null,
        complexity: "medium" as const,
      },
      content: "",
      status: "planning" as const,
      taskCount: 3,
      doneTaskCount: 0,
      dependencyCount: 0,
    };
    vi.mocked(api.plans.planTasks).mockResolvedValue(plan as never);

    await store.dispatch(generateTasksForPlan({ projectId: "proj-2", planId: "plan-2" }));

    expect(api.tasks.list).toHaveBeenCalledWith("proj-2");
  });

  it("invalidates plans queries and adds success toasts when sub-plan task generation reports child successes", async () => {
    const store = createStore();
    const plan = {
      metadata: {
        planId: "root-1",
        epicId: "epic-1",
        shippedAt: null,
        complexity: "medium" as const,
      },
      content: "",
      status: "planning" as const,
      taskCount: 2,
      doneTaskCount: 0,
      dependencyCount: 0,
      successPlanIds: ["child-alpha"],
      failedPlanIds: [],
    } satisfies Plan;
    vi.mocked(api.plans.planTasks).mockResolvedValue(plan as never);

    await store.dispatch(planTasks({ projectId: "proj-sub", planId: "root-1" }));

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.plans.list("proj-sub"),
    });
    const messages = store.getState().notification.items.map((n) => n.message);
    expect(messages.some((m) => m.includes("Child Alpha"))).toBe(true);
  });

  it("adds error toasts for failedPlanIds from plan-tasks response", async () => {
    const store = createStore();
    const plan = {
      metadata: {
        planId: "root-1",
        epicId: "epic-1",
        shippedAt: null,
        complexity: "medium" as const,
      },
      content: "",
      status: "planning" as const,
      taskCount: 0,
      doneTaskCount: 0,
      dependencyCount: 0,
      successPlanIds: [],
      failedPlanIds: ["bad-child"],
    } satisfies Plan;
    vi.mocked(api.plans.planTasks).mockResolvedValue(plan as never);

    await store.dispatch(planTasks({ projectId: "proj-err", planId: "root-1" }));

    expect(mockInvalidateQueries).toHaveBeenCalled();
    const messages = store.getState().notification.items.map((n) => n.message);
    expect(messages.some((m) => m.includes("Bad Child") && m.includes("failed"))).toBe(true);
  });

  it("runs same side effects for planTasksForSubtree.fulfilled", async () => {
    const root: Plan = {
      metadata: {
        planId: "root-1",
        epicId: "epic-1",
        shippedAt: null,
        complexity: "medium",
      },
      content: "",
      status: "planning",
      taskCount: 1,
      doneTaskCount: 0,
      dependencyCount: 0,
      successPlanIds: ["c1"],
      failedPlanIds: [],
    };
    vi.mocked(api.plans.planTasks).mockResolvedValue(root);
    vi.mocked(api.plans.get).mockResolvedValue({
      ...root,
      metadata: { ...root.metadata, planId: "c1", parentPlanId: "root-1" },
    });

    const store = createStore();
    await store.dispatch(planTasksForSubtree({ projectId: "proj-st", planId: "root-1" }));

    expect(api.tasks.list).toHaveBeenCalledWith("proj-st");
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.plans.list("proj-st"),
    });
  });

  it("does not dispatch fetchTasks when planTasks.rejected", async () => {
    const store = createStore();
    vi.mocked(api.plans.planTasks).mockRejectedValue(new Error("Planner failed"));

    await store.dispatch(planTasks({ projectId: "proj-1", planId: "plan-1" }));

    expect(api.tasks.list).not.toHaveBeenCalled();
  });

  it("refreshes tasks and execute status when executePlan.fulfilled", async () => {
    const store = createStore();
    vi.mocked(api.plans.execute).mockResolvedValue(undefined as never);

    await store.dispatch(executePlan({ projectId: "proj-3", planId: "plan-3" }));

    expect(api.tasks.list).toHaveBeenCalledWith("proj-3");
    expect(api.execute.status).toHaveBeenCalledWith("proj-3");
  });

  it("planTasksAffectedMultiplePlans is false for single-root success only", () => {
    const plan: Plan = {
      metadata: {
        planId: "p1",
        epicId: "e1",
        shippedAt: null,
        complexity: "medium",
      },
      content: "",
      status: "planning",
      taskCount: 1,
      doneTaskCount: 0,
      dependencyCount: 0,
      successPlanIds: ["p1"],
      failedPlanIds: [],
    };
    expect(planTasksAffectedMultiplePlans(plan)).toBe(false);
  });

  it("planTasksAffectedMultiplePlans is true when childPlanIds present", () => {
    const plan: Plan = {
      metadata: {
        planId: "p1",
        epicId: "e1",
        shippedAt: null,
        complexity: "medium",
      },
      content: "",
      status: "planning",
      taskCount: 0,
      doneTaskCount: 0,
      dependencyCount: 0,
      childPlanIds: ["c1"],
    };
    expect(planTasksAffectedMultiplePlans(plan)).toBe(true);
  });

  it("refreshes tasks and execute status when reExecutePlan.fulfilled", async () => {
    const store = createStore();
    vi.mocked(api.plans.reExecute).mockResolvedValue(undefined as never);

    await store.dispatch(reExecutePlan({ projectId: "proj-4", planId: "plan-4" }));

    expect(api.tasks.list).toHaveBeenCalledWith("proj-4");
    expect(api.execute.status).toHaveBeenCalledWith("proj-4");
  });
});
