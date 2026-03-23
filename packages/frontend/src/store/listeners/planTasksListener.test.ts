import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import planReducer from "../slices/planSlice";
import executeReducer from "../slices/executeSlice";
import projectReducer from "../slices/projectSlice";
import { planTasksListener } from "./planTasksListener";
import { planTasks, generateTasksForPlan, executePlan, reExecutePlan } from "../slices/planSlice";
import { api } from "../../api/client";

vi.mock("../../api/client", () => ({
  api: {
    plans: { planTasks: vi.fn(), execute: vi.fn(), reExecute: vi.fn() },
    tasks: { list: vi.fn() },
    execute: { status: vi.fn() },
  },
}));

function createStore() {
  return configureStore({
    reducer: {
      plan: planReducer,
      execute: executeReducer,
      project: projectReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(planTasksListener.middleware),
  });
}

describe("planTasksListener", () => {
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

  it("refreshes tasks and execute status when reExecutePlan.fulfilled", async () => {
    const store = createStore();
    vi.mocked(api.plans.reExecute).mockResolvedValue(undefined as never);

    await store.dispatch(reExecutePlan({ projectId: "proj-4", planId: "plan-4" }));

    expect(api.tasks.list).toHaveBeenCalledWith("proj-4");
    expect(api.execute.status).toHaveBeenCalledWith("proj-4");
  });
});
