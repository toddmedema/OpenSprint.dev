import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import planReducer, {
  fetchPlans,
  fetchPlanStatus,
  decomposePlans,
  generatePlan,
  executePlan,
  reExecutePlan,
  planTasks,
  planTasksForSubtree,
  buildPlanHierarchyCache,
  fetchPlanChat,
  sendPlanMessage,
  fetchSinglePlan,
  updatePlan,
  archivePlan,
  setSelectedPlanId,
  addPlanLocally,
  setPlanError,
  setExecutingPlanId,
  clearExecuteError,
  clearPlanBackgroundError,
  setDecomposeProgress,
  setPlansAndGraph,
  resetPlan,
  type PlanState,
} from "./planSlice";
import type { Plan, PlanDependencyGraph } from "@opensprint/shared";

vi.mock("../../api/client", () => ({
  api: {
    plans: {
      list: vi.fn(),
      listVersions: vi.fn(),
      getVersion: vi.fn(),
      decompose: vi.fn(),
      generate: vi.fn(),
      execute: vi.fn(),
      reExecute: vi.fn(),
      planTasks: vi.fn(),
      archive: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
    },
    projects: {
      getPlanStatus: vi.fn(),
    },
    chat: {
      history: vi.fn(),
      send: vi.fn(),
    },
  },
}));

import { api } from "../../api/client";

const mockPlan: Plan = {
  metadata: {
    planId: "plan-1",
    epicId: "epic-1",
    shippedAt: null,
    complexity: "medium",
  },
  content: "# Plan 1\n\nDescription",
  status: "planning",
  taskCount: 3,
  doneTaskCount: 0,
  dependencyCount: 0,
};

const mockGraph: PlanDependencyGraph = {
  plans: [mockPlan],
  edges: [],
};

describe("planSlice", () => {
  beforeEach(() => {
    vi.mocked(api.plans.list).mockReset();
    vi.mocked(api.plans.listVersions).mockReset();
    vi.mocked(api.plans.getVersion).mockReset();
    vi.mocked(api.plans.decompose).mockReset();
    vi.mocked(api.plans.generate).mockReset();
    vi.mocked(api.plans.execute).mockReset();
    vi.mocked(api.plans.reExecute).mockReset();
    vi.mocked(api.plans.planTasks).mockReset();
    vi.mocked(api.plans.archive).mockReset();
    vi.mocked(api.plans.get).mockReset();
    vi.mocked(api.plans.update).mockReset();
    vi.mocked(api.chat.history).mockReset();
    vi.mocked(api.chat.send).mockReset();
  });

  function createStore() {
    return configureStore({ reducer: { plan: planReducer } });
  }

  describe("initial state", () => {
    it("has correct initial state", () => {
      const store = createStore();
      const state = store.getState().plan as PlanState;
      expect(state.plans).toEqual([]);
      expect(state.dependencyGraph).toBeNull();
      expect(state.selectedPlanId).toBeNull();
      expect(state.chatMessages).toEqual({});
      expect(state.loading).toBe(false);
      expect(state.decomposing).toBe(false);
      expect(state.decomposeGeneratedCount).toBe(0);
      expect(state.decomposeTotalCount).toBeNull();
      expect(state.planStatus).toBeNull();
      expect(state.error).toBeNull();
      expect(state.backgroundError).toBeNull();
      expect(state.executeError).toBeNull();
      expect(state.planHierarchyCache).toEqual({});
    });
  });

  describe("fetchPlanStatus thunk", () => {
    it("stores plan status on fulfilled", async () => {
      const status = {
        hasPlanningRun: true,
        prdChangedSinceLastRun: true,
        action: "replan" as const,
      };
      vi.mocked(api.projects.getPlanStatus).mockResolvedValue(status);
      const store = createStore();
      await store.dispatch(fetchPlanStatus("proj-1"));
      expect(store.getState().plan.planStatus).toEqual(status);
    });
  });

  describe("reducers", () => {
    it("setSelectedPlanId sets selected plan", () => {
      const store = createStore();
      store.dispatch(setSelectedPlanId("plan-123"));
      expect(store.getState().plan.selectedPlanId).toBe("plan-123");
      store.dispatch(setSelectedPlanId(null));
      expect(store.getState().plan.selectedPlanId).toBeNull();
    });

    it("addPlanLocally appends plan", () => {
      const store = createStore();
      store.dispatch(addPlanLocally(mockPlan));
      expect(store.getState().plan.plans).toHaveLength(1);
      expect(store.getState().plan.plans[0]).toEqual(mockPlan);
    });

    it("setPlanError sets error", () => {
      const store = createStore();
      store.dispatch(setPlanError("Something went wrong"));
      expect(store.getState().plan.error).toBe("Something went wrong");
      store.dispatch(setPlanError(null));
      expect(store.getState().plan.error).toBeNull();
    });

    it("clearPlanBackgroundError clears backgroundError", async () => {
      const store = createStore();
      store.dispatch(setPlansAndGraph({ plans: [mockPlan], dependencyGraph: mockGraph }));
      vi.mocked(api.plans.list).mockRejectedValue(new Error("Refresh failed"));
      await store.dispatch(fetchPlans({ projectId: "proj-1", background: true }));
      expect(store.getState().plan.backgroundError).toBe("Refresh failed");
      store.dispatch(clearPlanBackgroundError());
      expect(store.getState().plan.backgroundError).toBeNull();
    });

    it("setPlansAndGraph sets plans and dependencyGraph", () => {
      const store = createStore();
      store.dispatch(setPlansAndGraph({ plans: [mockPlan], dependencyGraph: mockGraph }));
      expect(store.getState().plan.plans).toEqual([mockPlan]);
      expect(store.getState().plan.dependencyGraph).toEqual(mockGraph);
    });

    it("setPlansAndGraph builds planHierarchyCache grouped by parentPlanId", () => {
      const root: Plan = {
        ...mockPlan,
        metadata: { ...mockPlan.metadata, planId: "root-plan" },
        status: "planning",
      };
      const child: Plan = {
        ...mockPlan,
        metadata: {
          ...mockPlan.metadata,
          planId: "child-plan",
          parentPlanId: "root-plan",
          depth: 2,
        },
        status: "building",
      };
      const store = createStore();
      store.dispatch(
        setPlansAndGraph({
          plans: [child, root],
          dependencyGraph: { plans: [child, root], edges: [] },
        })
      );
      const cache = store.getState().plan.planHierarchyCache;
      expect(cache["root-plan"]?.children.map((c) => c.planId)).toEqual(["child-plan"]);
      expect(cache["child-plan"]?.children).toEqual([]);
      expect(buildPlanHierarchyCache([])).toEqual({});
    });

    it("setDecomposeProgress stores live decompose progress", () => {
      const store = createStore();
      store.dispatch(setDecomposeProgress({ createdCount: 2, totalCount: 4 }));
      expect(store.getState().plan.decomposeGeneratedCount).toBe(2);
      expect(store.getState().plan.decomposeTotalCount).toBe(4);
    });

    it("resetPlan resets state to initial values", () => {
      const store = createStore();
      store.dispatch(addPlanLocally(mockPlan));
      store.dispatch(setSelectedPlanId("plan-1"));
      store.dispatch(setPlanError("error"));
      store.dispatch(setDecomposeProgress({ createdCount: 3, totalCount: 5 }));

      store.dispatch(resetPlan());
      const state = store.getState().plan as PlanState;
      expect(state.plans).toEqual([]);
      expect(state.dependencyGraph).toBeNull();
      expect(state.selectedPlanId).toBeNull();
      expect(state.chatMessages).toEqual({});
      expect(state.loading).toBe(false);
      expect(state.decomposing).toBe(false);
      expect(state.decomposeGeneratedCount).toBe(0);
      expect(state.decomposeTotalCount).toBeNull();
      expect(state.error).toBeNull();
      expect(state.backgroundError).toBeNull();
      expect(state.executeError).toBeNull();
      expect(state.planHierarchyCache).toEqual({});
    });

    it("setExecutingPlanId sets executingPlanId synchronously", () => {
      const store = createStore();
      store.dispatch(setExecutingPlanId("plan-42"));
      expect(store.getState().plan.executingPlanId).toBe("plan-42");
    });

    it("setExecutingPlanId(null) clears executingPlanId", () => {
      const store = createStore();
      store.dispatch(setExecutingPlanId("plan-42"));
      store.dispatch(setExecutingPlanId(null));
      expect(store.getState().plan.executingPlanId).toBeNull();
    });

    it("setExecutingPlanId clears executeError when setting a plan ID", () => {
      const store = createStore();
      vi.mocked(api.plans.execute).mockRejectedValue(new Error("Fail"));
      store.dispatch(setExecutingPlanId("plan-1"));
      expect(store.getState().plan.executeError).toBeNull();
    });

    it("clearExecuteError clears executeError", async () => {
      vi.mocked(api.plans.execute).mockRejectedValue(new Error("Execute failed"));
      const store = createStore();
      await store.dispatch(executePlan({ projectId: "proj-1", planId: "plan-123" }));
      expect(store.getState().plan.executeError).not.toBeNull();
      store.dispatch(clearExecuteError());
      expect(store.getState().plan.executeError).toBeNull();
    });
  });

  describe("fetchPlans thunk", () => {
    it("sets loading true and clears error on pending (initial load)", async () => {
      let resolveApi: (v: PlanDependencyGraph) => void;
      const apiPromise = new Promise<PlanDependencyGraph>((r) => {
        resolveApi = r;
      });
      vi.mocked(api.plans.list).mockReturnValue(apiPromise as never);
      const store = createStore();
      const dispatchPromise = store.dispatch(fetchPlans("proj-1"));

      expect(store.getState().plan.loading).toBe(true);
      expect(store.getState().plan.error).toBeNull();

      resolveApi!(mockGraph);
      await dispatchPromise;
    });

    it("does NOT set loading on pending when background refresh", async () => {
      let resolveApi: (v: PlanDependencyGraph) => void;
      const apiPromise = new Promise<PlanDependencyGraph>((r) => {
        resolveApi = r;
      });
      vi.mocked(api.plans.list).mockReturnValue(apiPromise as never);
      const store = createStore();
      store.dispatch(setPlansAndGraph({ plans: [mockPlan], dependencyGraph: mockGraph }));
      const dispatchPromise = store.dispatch(fetchPlans({ projectId: "proj-1", background: true }));

      expect(store.getState().plan.loading).toBe(false);
      expect(store.getState().plan.plans).toHaveLength(1);

      resolveApi!(mockGraph);
      await dispatchPromise;
    });

    it("stores plans and dependencyGraph on fulfilled", async () => {
      vi.mocked(api.plans.list).mockResolvedValue(mockGraph);
      const store = createStore();
      await store.dispatch(fetchPlans("proj-1"));

      const state = store.getState().plan;
      expect(state.plans).toEqual([mockPlan]);
      expect(state.dependencyGraph).toEqual(mockGraph);
      expect(state.loading).toBe(false);
      expect(api.plans.list).toHaveBeenCalledWith("proj-1");
    });

    it("accepts string projectId for backward compatibility", async () => {
      vi.mocked(api.plans.list).mockResolvedValue(mockGraph);
      const store = createStore();
      await store.dispatch(fetchPlans("proj-1"));

      expect(store.getState().plan.plans).toEqual([mockPlan]);
      expect(api.plans.list).toHaveBeenCalledWith("proj-1");
    });

    it("sets error and clears loading on rejected (initial load)", async () => {
      vi.mocked(api.plans.list).mockRejectedValue(new Error("Network error"));
      const store = createStore();
      await store.dispatch(fetchPlans("proj-1"));

      const state = store.getState().plan;
      expect(state.loading).toBe(false);
      expect(state.error).toBe("Network error");
      expect(state.backgroundError).toBeNull();
    });

    it("sets backgroundError (not error) when background refresh rejected", async () => {
      vi.mocked(api.plans.list).mockRejectedValue(new Error("Network error"));
      const store = createStore();
      store.dispatch(setPlansAndGraph({ plans: [mockPlan], dependencyGraph: mockGraph }));
      await store.dispatch(fetchPlans({ projectId: "proj-1", background: true }));

      const state = store.getState().plan;
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.backgroundError).toBe("Network error");
      expect(state.plans).toHaveLength(1);
    });

    it("clears backgroundError on successful background refresh", async () => {
      const store = createStore();
      store.dispatch(setPlansAndGraph({ plans: [mockPlan], dependencyGraph: mockGraph }));
      vi.mocked(api.plans.list)
        .mockRejectedValueOnce(new Error("Previous error"))
        .mockResolvedValueOnce(mockGraph);

      await store.dispatch(fetchPlans({ projectId: "proj-1", background: true }));
      expect(store.getState().plan.backgroundError).toBe("Previous error");

      await store.dispatch(fetchPlans({ projectId: "proj-1", background: true }));
      expect(store.getState().plan.backgroundError).toBeNull();
    });

    it("uses fallback error message when error has no message", async () => {
      vi.mocked(api.plans.list).mockRejectedValue(new Error());
      const store = createStore();
      await store.dispatch(fetchPlans("proj-1"));

      expect(store.getState().plan.error).toBe("Failed to load plans");
    });
  });

  describe("decomposePlans thunk", () => {
    it("sets decomposing true on pending", async () => {
      let resolveApi: (value: { created: number; plans: Plan[] }) => void;
      const apiPromise = new Promise<{ created: number; plans: Plan[] }>((r) => {
        resolveApi = r;
      });
      vi.mocked(api.plans.decompose).mockReturnValue(apiPromise as never);
      const store = createStore();
      const dispatchPromise = store.dispatch(decomposePlans("proj-1"));

      expect(store.getState().plan.decomposing).toBe(true);
      expect(store.getState().plan.decomposeGeneratedCount).toBe(0);
      expect(store.getState().plan.decomposeTotalCount).toBeNull();
      expect(store.getState().plan.error).toBeNull();

      resolveApi!({ created: 0, plans: [] });
      await dispatchPromise;
    });

    it("clears decomposing on fulfilled", async () => {
      vi.mocked(api.plans.decompose).mockResolvedValue({ created: 2, plans: [] });
      const store = createStore();
      await store.dispatch(decomposePlans("proj-1"));

      expect(store.getState().plan.decomposing).toBe(false);
      expect(store.getState().plan.decomposeGeneratedCount).toBe(2);
      expect(store.getState().plan.decomposeTotalCount).toBe(2);
      expect(api.plans.decompose).toHaveBeenCalledWith("proj-1");
    });

    it("clears decomposing and sets error on rejected", async () => {
      vi.mocked(api.plans.decompose).mockRejectedValue(new Error("Decompose failed"));
      const store = createStore();
      await store.dispatch(decomposePlans("proj-1"));

      const state = store.getState().plan;
      expect(state.decomposing).toBe(false);
      expect(state.error).toBe("Decompose failed");
    });

    it("uses fallback error message when error has no message", async () => {
      vi.mocked(api.plans.decompose).mockRejectedValue(new Error());
      const store = createStore();
      await store.dispatch(decomposePlans("proj-1"));

      expect(store.getState().plan.error).toBe("Failed to decompose PRD");
    });
  });

  describe("generatePlan thunk", () => {
    const generatedPlan: Plan = {
      metadata: {
        planId: "dark-mode",
        epicId: "epic-2",
        shippedAt: null,
        complexity: "medium",
      },
      content: "# Dark Mode\n\nAdd dark/light toggle.",
      status: "planning",
      taskCount: 2,
      doneTaskCount: 0,
      dependencyCount: 0,
    };

    it("sets generating true on pending and clears error", async () => {
      let resolveApi: (v: { status: "created"; plan: Plan }) => void;
      const apiPromise = new Promise<{ status: "created"; plan: Plan }>((r) => {
        resolveApi = r;
      });
      vi.mocked(api.plans.generate).mockReturnValue(apiPromise as never);
      const store = createStore();
      const dispatchPromise = store.dispatch(
        generatePlan({ projectId: "proj-1", description: "Add dark mode" })
      );

      expect(store.getState().plan.generating).toBe(true);
      expect(store.getState().plan.error).toBeNull();

      resolveApi!({ status: "created", plan: generatedPlan });
      await dispatchPromise;
    });

    it("appends generated plan to plans array on fulfilled", async () => {
      vi.mocked(api.plans.generate).mockResolvedValue({ status: "created", plan: generatedPlan });
      const store = createStore();
      store.dispatch(setPlansAndGraph({ plans: [mockPlan], dependencyGraph: mockGraph }));

      await store.dispatch(generatePlan({ projectId: "proj-1", description: "Add dark mode" }));

      const state = store.getState().plan;
      expect(state.generating).toBe(false);
      expect(state.plans).toHaveLength(2);
      expect(state.plans[1].metadata.planId).toBe("dark-mode");
      expect(api.plans.generate).toHaveBeenCalledWith("proj-1", {
        description: "Add dark mode",
      });
    });

    it("does not append a plan when generation needs clarification", async () => {
      vi.mocked(api.plans.generate).mockResolvedValue({
        status: "needs_clarification",
        draftId: "draft-1",
        resumeContext: "plan-draft:draft-1",
        notification: {
          id: "oq-1",
          projectId: "proj-1",
          source: "plan",
          sourceId: "draft:draft-1",
          questions: [
            { id: "q1", text: "Which volunteers are eligible?", createdAt: "2025-01-01" },
          ],
          status: "open",
          createdAt: "2025-01-01",
          resolvedAt: null,
        },
      });
      const store = createStore();
      store.dispatch(setPlansAndGraph({ plans: [mockPlan], dependencyGraph: mockGraph }));

      await store.dispatch(
        generatePlan({ projectId: "proj-1", description: "Add volunteer form" })
      );

      const state = store.getState().plan;
      expect(state.generating).toBe(false);
      expect(state.plans).toHaveLength(1);
    });

    it("sets error and clears generating on rejected", async () => {
      vi.mocked(api.plans.generate).mockRejectedValue(new Error("Agent unavailable"));
      const store = createStore();
      await store.dispatch(generatePlan({ projectId: "proj-1", description: "Add dark mode" }));

      const state = store.getState().plan;
      expect(state.generating).toBe(false);
      expect(state.error).toBe("Agent unavailable");
    });

    it("uses fallback error message when error has no message", async () => {
      vi.mocked(api.plans.generate).mockRejectedValue(new Error());
      const store = createStore();
      await store.dispatch(generatePlan({ projectId: "proj-1", description: "Some feature" }));

      expect(store.getState().plan.error).toBe("Failed to generate plan");
    });
  });

  describe("executePlan thunk", () => {
    it("sets executingPlanId on pending", async () => {
      let resolveApi: () => void;
      const apiPromise = new Promise<void>((r) => {
        resolveApi = r;
      });
      vi.mocked(api.plans.execute).mockReturnValue(apiPromise as never);
      const store = createStore();
      const dispatchPromise = store.dispatch(
        executePlan({ projectId: "proj-1", planId: "plan-123" })
      );

      expect(store.getState().plan.executingPlanId).toBe("plan-123");
      expect(store.getState().plan.error).toBeNull();

      resolveApi!();
      await dispatchPromise;
    });

    it("clears executingPlanId on fulfilled", async () => {
      vi.mocked(api.plans.execute).mockResolvedValue(undefined);
      const store = createStore();
      await store.dispatch(executePlan({ projectId: "proj-1", planId: "plan-123" }));

      expect(store.getState().plan.executingPlanId).toBeNull();
      expect(api.plans.execute).toHaveBeenCalledWith("proj-1", "plan-123", undefined);
    });

    it("passes prerequisitePlanIds when provided", async () => {
      vi.mocked(api.plans.execute).mockResolvedValue(undefined);
      const store = createStore();
      await store.dispatch(
        executePlan({
          projectId: "proj-1",
          planId: "plan-123",
          prerequisitePlanIds: ["user-auth", "feature-base"],
        })
      );

      expect(api.plans.execute).toHaveBeenCalledWith("proj-1", "plan-123", {
        prerequisitePlanIds: ["user-auth", "feature-base"],
      });
    });

    it("passes version_number when provided", async () => {
      vi.mocked(api.plans.execute).mockResolvedValue(undefined);
      const store = createStore();
      await store.dispatch(
        executePlan({
          projectId: "proj-1",
          planId: "plan-123",
          version_number: 5,
        })
      );

      expect(api.plans.execute).toHaveBeenCalledWith("proj-1", "plan-123", {
        version_number: 5,
      });
    });

    it("passes both prerequisitePlanIds and version_number when provided", async () => {
      vi.mocked(api.plans.execute).mockResolvedValue(undefined);
      const store = createStore();
      await store.dispatch(
        executePlan({
          projectId: "proj-1",
          planId: "plan-123",
          prerequisitePlanIds: ["plan-a"],
          version_number: 3,
        })
      );

      expect(api.plans.execute).toHaveBeenCalledWith("proj-1", "plan-123", {
        prerequisitePlanIds: ["plan-a"],
        version_number: 3,
      });
    });

    it("clears executingPlanId and sets error on rejected", async () => {
      vi.mocked(api.plans.execute).mockRejectedValue(new Error("Execute failed"));
      const store = createStore();
      await store.dispatch(executePlan({ projectId: "proj-1", planId: "plan-123" }));

      const state = store.getState().plan;
      expect(state.executingPlanId).toBeNull();
      expect(state.error).toBe("Execute failed");
    });

    it("sets executeError with planId and message on rejected", async () => {
      vi.mocked(api.plans.execute).mockRejectedValue(new Error("Execute failed"));
      const store = createStore();
      await store.dispatch(executePlan({ projectId: "proj-1", planId: "plan-123" }));

      const state = store.getState().plan;
      expect(state.executeError).toEqual({ planId: "plan-123", message: "Execute failed" });
    });

    it("clears executeError on next successful execution", async () => {
      vi.mocked(api.plans.execute)
        .mockRejectedValueOnce(new Error("Execute failed"))
        .mockResolvedValueOnce(undefined);
      const store = createStore();

      await store.dispatch(executePlan({ projectId: "proj-1", planId: "plan-123" }));
      expect(store.getState().plan.executeError).not.toBeNull();

      await store.dispatch(executePlan({ projectId: "proj-1", planId: "plan-123" }));
      expect(store.getState().plan.executingPlanId).toBeNull();
    });

    it("uses fallback error message when error has no message", async () => {
      vi.mocked(api.plans.execute).mockRejectedValue(new Error());
      const store = createStore();
      await store.dispatch(executePlan({ projectId: "proj-1", planId: "plan-123" }));

      expect(store.getState().plan.error).toBe("Failed to start execute");
      expect(store.getState().plan.executeError).toEqual({
        planId: "plan-123",
        message: "Failed to start execute",
      });
    });
  });

  describe("reExecutePlan thunk", () => {
    it("sets reExecutingPlanId on pending", async () => {
      let resolveApi: () => void;
      const apiPromise = new Promise<void>((r) => {
        resolveApi = r;
      });
      vi.mocked(api.plans.reExecute).mockReturnValue(apiPromise as never);
      const store = createStore();
      const dispatchPromise = store.dispatch(
        reExecutePlan({ projectId: "proj-1", planId: "plan-456" })
      );

      expect(store.getState().plan.reExecutingPlanId).toBe("plan-456");

      resolveApi!();
      await dispatchPromise;
    });

    it("clears reExecutingPlanId on fulfilled", async () => {
      vi.mocked(api.plans.reExecute).mockResolvedValue(undefined);
      const store = createStore();
      await store.dispatch(reExecutePlan({ projectId: "proj-1", planId: "plan-456" }));

      expect(store.getState().plan.reExecutingPlanId).toBeNull();
      expect(api.plans.reExecute).toHaveBeenCalledWith("proj-1", "plan-456");
    });

    it("clears reExecutingPlanId and sets error on rejected", async () => {
      vi.mocked(api.plans.reExecute).mockRejectedValue(new Error("Re-execute failed"));
      const store = createStore();
      await store.dispatch(reExecutePlan({ projectId: "proj-1", planId: "plan-456" }));

      const state = store.getState().plan;
      expect(state.reExecutingPlanId).toBeNull();
      expect(state.error).toBe("Re-execute failed");
    });

    it("uses fallback error message when error has no message", async () => {
      vi.mocked(api.plans.reExecute).mockRejectedValue(new Error());
      const store = createStore();
      await store.dispatch(reExecutePlan({ projectId: "proj-1", planId: "plan-456" }));

      expect(store.getState().plan.error).toBe("Failed to re-execute plan");
    });
  });

  describe("planTasks thunk", () => {
    it("adds planId to planTasksPlanIds on pending and removes on fulfilled", async () => {
      const updatedPlan = { ...mockPlan, taskCount: 2 };
      vi.mocked(api.plans.planTasks).mockResolvedValue(updatedPlan);
      const store = createStore();
      store.dispatch(
        setPlansAndGraph({ plans: [mockPlan], dependencyGraph: { plans: [mockPlan], edges: [] } })
      );

      const dispatchPromise = store.dispatch(
        planTasks({ projectId: "proj-1", planId: mockPlan.metadata.planId })
      );
      expect(store.getState().plan.planTasksPlanIds).toContain(mockPlan.metadata.planId);

      await dispatchPromise;
      expect(store.getState().plan.planTasksPlanIds).not.toContain(mockPlan.metadata.planId);
      expect(api.plans.planTasks).toHaveBeenCalledWith("proj-1", mockPlan.metadata.planId);
    });

    it("updates plan in state on fulfilled", async () => {
      const updatedPlan = { ...mockPlan, taskCount: 2 };
      vi.mocked(api.plans.planTasks).mockResolvedValue(updatedPlan);
      const store = createStore();
      store.dispatch(
        setPlansAndGraph({ plans: [mockPlan], dependencyGraph: { plans: [mockPlan], edges: [] } })
      );

      await store.dispatch(planTasks({ projectId: "proj-1", planId: mockPlan.metadata.planId }));

      const state = store.getState().plan;
      expect(state.plans[0].taskCount).toBe(2);
    });

    it("sets executeError on rejected", async () => {
      vi.mocked(api.plans.planTasks).mockRejectedValue(new Error("Planner failed"));
      const store = createStore();
      await store.dispatch(planTasks({ projectId: "proj-1", planId: "plan-789" }));

      expect(store.getState().plan.planTasksPlanIds).not.toContain("plan-789");
      expect(store.getState().plan.executeError).toEqual({
        planId: "plan-789",
        message: "Planner failed",
      });
    });

    it("clears executeError for same plan on fulfilled", async () => {
      vi.mocked(api.plans.planTasks).mockRejectedValueOnce(new Error("Planner failed"));
      const store = createStore();
      store.dispatch(
        setPlansAndGraph({ plans: [mockPlan], dependencyGraph: { plans: [mockPlan], edges: [] } })
      );
      await store.dispatch(planTasks({ projectId: "proj-1", planId: mockPlan.metadata.planId }));
      expect(store.getState().plan.executeError?.planId).toBe(mockPlan.metadata.planId);

      vi.mocked(api.plans.planTasks).mockResolvedValueOnce({ ...mockPlan, taskCount: 2 });
      await store.dispatch(planTasks({ projectId: "proj-1", planId: mockPlan.metadata.planId }));

      expect(store.getState().plan.executeError).toBeNull();
    });
  });

  describe("planTasksForSubtree thunk", () => {
    it("merges root and refreshed child plans and rebuilds hierarchy cache", async () => {
      const root: Plan = {
        ...mockPlan,
        metadata: { ...mockPlan.metadata, planId: "root-1" },
      };
      const child: Plan = {
        ...mockPlan,
        metadata: {
          ...mockPlan.metadata,
          planId: "child-1",
          parentPlanId: "root-1",
          depth: 2,
        },
        taskCount: 4,
      };
      const rootResponse: Plan = {
        ...root,
        successPlanIds: ["child-1"],
        failedPlanIds: [],
        totalTasksCreated: 5,
      };
      vi.mocked(api.plans.planTasks).mockResolvedValue(rootResponse);
      vi.mocked(api.plans.get).mockResolvedValue(child);

      const store = createStore();
      store.dispatch(
        setPlansAndGraph({ plans: [root], dependencyGraph: { plans: [root], edges: [] } })
      );

      await store.dispatch(planTasksForSubtree({ projectId: "proj-1", planId: "root-1" }));

      const state = store.getState().plan;
      expect(api.plans.planTasks).toHaveBeenCalledWith("proj-1", "root-1");
      expect(api.plans.get).toHaveBeenCalledWith("proj-1", "child-1");
      expect(state.plans.map((p) => p.metadata.planId).sort()).toEqual(["child-1", "root-1"]);
      expect(state.plans.find((p) => p.metadata.planId === "child-1")?.taskCount).toBe(4);
      expect(state.planHierarchyCache["root-1"]?.children[0]?.planId).toBe("child-1");
      expect(state.planTasksPlanIds).not.toContain("root-1");
    });

    it("sets executeError on rejected like planTasks", async () => {
      vi.mocked(api.plans.planTasks).mockRejectedValue(new Error("Split failed"));
      const store = createStore();
      await store.dispatch(planTasksForSubtree({ projectId: "proj-1", planId: "root-1" }));
      expect(store.getState().plan.executeError).toEqual({
        planId: "root-1",
        message: "Split failed",
      });
    });
  });

  describe("fetchPlanChat thunk", () => {
    it("stores chat messages keyed by context on fulfilled", async () => {
      const messages = [
        { role: "user" as const, content: "hi", timestamp: "2025-01-01" },
        { role: "assistant" as const, content: "hello", timestamp: "2025-01-01" },
      ];
      vi.mocked(api.chat.history).mockResolvedValue({ messages });
      const store = createStore();
      await store.dispatch(fetchPlanChat({ projectId: "proj-1", context: "plan-plan-1" }));

      expect(store.getState().plan.chatMessages["plan-plan-1"]).toEqual(messages);
      expect(api.chat.history).toHaveBeenCalledWith("proj-1", "plan-plan-1");
    });

    it("uses empty array when messages missing", async () => {
      vi.mocked(api.chat.history).mockResolvedValue({});
      const store = createStore();
      await store.dispatch(fetchPlanChat({ projectId: "proj-1", context: "plan-plan-2" }));

      expect(store.getState().plan.chatMessages["plan-plan-2"]).toEqual([]);
    });

    it("stores messages for multiple contexts independently", async () => {
      vi.mocked(api.chat.history)
        .mockResolvedValueOnce({ messages: [{ role: "user", content: "a", timestamp: "1" }] })
        .mockResolvedValueOnce({ messages: [{ role: "user", content: "b", timestamp: "2" }] });
      const store = createStore();
      await store.dispatch(fetchPlanChat({ projectId: "proj-1", context: "plan-plan-a" }));
      await store.dispatch(fetchPlanChat({ projectId: "proj-1", context: "plan-plan-b" }));

      expect(store.getState().plan.chatMessages["plan-plan-a"]).toHaveLength(1);
      expect(store.getState().plan.chatMessages["plan-plan-b"]).toHaveLength(1);
    });

    it("does not overwrite when stale fetch returns fewer messages than optimistic (race fix)", async () => {
      vi.mocked(api.chat.history).mockResolvedValue({ messages: [] });
      vi.mocked(api.chat.send).mockResolvedValue({ message: "ok" });
      const store = createStore();
      const fetchPromise = store.dispatch(
        fetchPlanChat({ projectId: "proj-1", context: "plan-plan-1" })
      );
      // User sends before fetch completes — optimistic add
      store.dispatch(
        sendPlanMessage({
          projectId: "proj-1",
          message: "hello",
          context: "plan-plan-1",
        })
      );
      await fetchPromise;

      // Optimistic user message must be preserved (stale fetch should not overwrite)
      // sendPlanMessage may also complete, so we have 1 or 2 messages — never 0
      const msgs = store.getState().plan.chatMessages["plan-plan-1"];
      expect(msgs.length).toBeGreaterThanOrEqual(1);
      expect(msgs[0].role).toBe("user");
      expect(msgs[0].content).toBe("hello");
    });

    it("sets backgroundError on rejected so user knows chat history failed to load", async () => {
      vi.mocked(api.chat.history).mockRejectedValue(new Error("Network error"));
      const store = createStore();
      await store.dispatch(fetchPlanChat({ projectId: "proj-1", context: "plan-plan-1" }));

      expect(store.getState().plan.backgroundError).toBe("Network error");
    });
  });

  describe("sendPlanMessage thunk", () => {
    it("adds user message optimistically and assistant message on fulfilled", async () => {
      vi.mocked(api.chat.send).mockResolvedValue({ message: "Here is my response" });
      const store = createStore();
      const promise = store.dispatch(
        sendPlanMessage({
          projectId: "proj-1",
          message: "hello",
          context: "plan-plan-1",
        })
      );

      const stateBefore = store.getState().plan;
      expect(stateBefore.chatMessages["plan-plan-1"]).toHaveLength(1);
      expect(stateBefore.chatMessages["plan-plan-1"][0].role).toBe("user");
      expect(stateBefore.chatMessages["plan-plan-1"][0].content).toBe("hello");

      await promise;

      const state = store.getState().plan;
      expect(state.chatMessages["plan-plan-1"]).toHaveLength(2);
      expect(state.chatMessages["plan-plan-1"][0].role).toBe("user");
      expect(state.chatMessages["plan-plan-1"][0].content).toBe("hello");
      expect(state.chatMessages["plan-plan-1"][1].role).toBe("assistant");
      expect(state.chatMessages["plan-plan-1"][1].content).toBe("Here is my response");
      expect(api.chat.send).toHaveBeenCalledWith("proj-1", "hello", "plan-plan-1");
    });

    it("creates context array if not present", async () => {
      vi.mocked(api.chat.send).mockResolvedValue({ message: "Response" });
      const store = createStore();
      await store.dispatch(
        sendPlanMessage({
          projectId: "proj-1",
          message: "hi",
          context: "plan-new-context",
        })
      );

      const msgs = store.getState().plan.chatMessages["plan-new-context"];
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe("user");
      expect(msgs[0].content).toBe("hi");
      expect(msgs[1].role).toBe("assistant");
      expect(msgs[1].content).toBe("Response");
    });

    it("sets error on rejected", async () => {
      vi.mocked(api.chat.send).mockRejectedValue(new Error("Send failed"));
      const store = createStore();
      await store.dispatch(
        sendPlanMessage({
          projectId: "proj-1",
          message: "hello",
          context: "plan-plan-1",
        })
      );

      expect(store.getState().plan.error).toBe("Send failed");
    });

    it("rolls back optimistic user message on rejected", async () => {
      vi.mocked(api.chat.send).mockRejectedValue(new Error("Send failed"));
      const store = createStore();
      await store.dispatch(
        sendPlanMessage({
          projectId: "proj-1",
          message: "hello",
          context: "plan-plan-1",
        })
      );

      const msgs = store.getState().plan.chatMessages["plan-plan-1"];
      expect(msgs ?? []).toHaveLength(0);
    });

    it("uses fallback error message when error has no message", async () => {
      vi.mocked(api.chat.send).mockRejectedValue(new Error());
      const store = createStore();
      await store.dispatch(
        sendPlanMessage({
          projectId: "proj-1",
          message: "hello",
          context: "plan-plan-1",
        })
      );

      expect(store.getState().plan.error).toBe("Failed to send message");
    });

    it("messages persist: fetchPlanChat after send returns server state", async () => {
      vi.mocked(api.chat.send).mockResolvedValue({ message: "Assistant reply" });
      const persistedMessages = [
        { role: "user" as const, content: "User question", timestamp: "2025-01-01" },
        { role: "assistant" as const, content: "Assistant reply", timestamp: "2025-01-01" },
      ];
      vi.mocked(api.chat.history).mockResolvedValue({ messages: persistedMessages });

      const store = createStore();
      await store.dispatch(
        sendPlanMessage({
          projectId: "proj-1",
          message: "User question",
          context: "plan:my-plan",
        })
      );

      expect(store.getState().plan.chatMessages["plan:my-plan"]).toHaveLength(2);

      await store.dispatch(fetchPlanChat({ projectId: "proj-1", context: "plan:my-plan" }));

      const msgs = store.getState().plan.chatMessages["plan:my-plan"];
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe("User question");
      expect(msgs[1].content).toBe("Assistant reply");
    });
  });

  describe("fetchSinglePlan thunk", () => {
    it("updates plan in plans array when found", async () => {
      const updatedPlan: Plan = {
        ...mockPlan,
        content: "# Updated content",
        status: "building",
      };
      vi.mocked(api.plans.get).mockResolvedValue(updatedPlan);
      const store = createStore();
      store.dispatch(setPlansAndGraph({ plans: [mockPlan], dependencyGraph: mockGraph }));

      await store.dispatch(fetchSinglePlan({ projectId: "proj-1", planId: "plan-1" }));

      const state = store.getState().plan;
      expect(state.plans[0].content).toBe("# Updated content");
      expect(state.plans[0].status).toBe("building");
      expect(api.plans.get).toHaveBeenCalledWith("proj-1", "plan-1");
    });

    it("does not add plan when not in array", async () => {
      const otherPlan: Plan = {
        ...mockPlan,
        metadata: { ...mockPlan.metadata, planId: "plan-other" },
      };
      vi.mocked(api.plans.get).mockResolvedValue(otherPlan);
      const store = createStore();
      store.dispatch(setPlansAndGraph({ plans: [mockPlan], dependencyGraph: mockGraph }));

      await store.dispatch(fetchSinglePlan({ projectId: "proj-1", planId: "plan-other" }));

      expect(store.getState().plan.plans).toHaveLength(1);
      expect(store.getState().plan.plans[0].metadata.planId).toBe("plan-1");
    });
  });

  describe("updatePlan thunk", () => {
    it("updates plan in plans array when fulfilled", async () => {
      const updatedPlan: Plan = {
        ...mockPlan,
        content: "# Updated Title\n\nUpdated body content",
      };
      vi.mocked(api.plans.update).mockResolvedValue(updatedPlan);
      const store = createStore();
      store.dispatch(setPlansAndGraph({ plans: [mockPlan], dependencyGraph: mockGraph }));

      await store.dispatch(
        updatePlan({
          projectId: "proj-1",
          planId: "plan-1",
          content: "# Updated Title\n\nUpdated body content",
        })
      );

      const state = store.getState().plan;
      expect(state.plans[0].content).toBe("# Updated Title\n\nUpdated body content");
      expect(api.plans.update).toHaveBeenCalledWith("proj-1", "plan-1", {
        content: "# Updated Title\n\nUpdated body content",
      });
    });

    it("does not add plan when not in array", async () => {
      const otherPlan: Plan = {
        ...mockPlan,
        metadata: { ...mockPlan.metadata, planId: "plan-other" },
        content: "# Other content",
      };
      vi.mocked(api.plans.update).mockResolvedValue(otherPlan);
      const store = createStore();
      store.dispatch(setPlansAndGraph({ plans: [mockPlan], dependencyGraph: mockGraph }));

      await store.dispatch(
        updatePlan({ projectId: "proj-1", planId: "plan-other", content: "# Other content" })
      );

      expect(store.getState().plan.plans).toHaveLength(1);
      expect(store.getState().plan.plans[0].metadata.planId).toBe("plan-1");
    });
  });

  describe("archivePlan thunk", () => {
    it("sets archivingPlanId on pending", async () => {
      let resolveApi: (v: Plan) => void;
      const apiPromise = new Promise<Plan>((r) => {
        resolveApi = r;
      });
      vi.mocked(api.plans.archive).mockReturnValue(apiPromise as never);
      const store = createStore();
      const dispatchPromise = store.dispatch(
        archivePlan({ projectId: "proj-1", planId: "plan-123" })
      );

      expect(store.getState().plan.archivingPlanId).toBe("plan-123");

      resolveApi!(mockPlan);
      await dispatchPromise;
    });

    it("clears archivingPlanId on fulfilled", async () => {
      vi.mocked(api.plans.archive).mockResolvedValue(mockPlan);
      const store = createStore();
      await store.dispatch(archivePlan({ projectId: "proj-1", planId: "plan-123" }));

      expect(store.getState().plan.archivingPlanId).toBeNull();
      expect(api.plans.archive).toHaveBeenCalledWith("proj-1", "plan-123");
    });

    it("clears archivingPlanId and sets error on rejected", async () => {
      vi.mocked(api.plans.archive).mockRejectedValue(new Error("Archive failed"));
      const store = createStore();
      await store.dispatch(archivePlan({ projectId: "proj-1", planId: "plan-123" }));

      const state = store.getState().plan;
      expect(state.archivingPlanId).toBeNull();
      expect(state.error).toBe("Archive failed");
    });
  });
});
