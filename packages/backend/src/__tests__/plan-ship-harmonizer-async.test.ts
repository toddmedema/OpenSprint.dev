import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PlanShipService,
  type PlanShipDeps,
  type PlanShipStore,
} from "../services/plan-ship.service.js";
import type { Plan, PlanComplexity } from "@opensprint/shared";

vi.mock("../services/plan-versioning.service.js", () => ({
  getContentAndVersionForShip: vi.fn().mockResolvedValue({
    versionContent: "# Test\n\nContent.",
    versionToExecute: 1,
  }),
  setExecutedVersion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../websocket/index.js", () => ({
  broadcastToProject: vi.fn(),
  sendPlanAgentOutputToProject: vi.fn(),
}));

vi.mock("../services/plan-agent-output-buffer.service.js", () => ({
  appendPlanAgentOutput: vi.fn(),
  clearPlanAgentOutput: vi.fn(),
}));

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    content: "# Test Plan\n\nContent.",
    status: "planning",
    taskCount: 2,
    doneTaskCount: 0,
    metadata: {
      planId: "test-plan",
      epicId: "epic-1",
      shippedAt: null,
      complexity: "medium" as PlanComplexity,
      reviewedAt: null,
    },
    lastModified: new Date().toISOString(),
    currentVersionNumber: 1,
    ...overrides,
  };
}

function makeStore(): PlanShipStore {
  return {
    planGet: vi.fn().mockResolvedValue(null),
    planVersionGetByVersionNumber: vi.fn().mockResolvedValue({ content: "# V1" }),
    planVersionList: vi.fn().mockResolvedValue([]),
    planVersionInsert: vi.fn().mockResolvedValue({}),
    planVersionSetExecutedVersion: vi.fn().mockResolvedValue(undefined),
    planUpdateVersionNumbers: vi.fn().mockResolvedValue(undefined),
    planSetShippedContent: vi.fn().mockResolvedValue(undefined),
    planUpdateMetadata: vi.fn().mockResolvedValue(undefined),
    planGetShippedContent: vi.fn().mockResolvedValue(null),
    listAll: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    createWithRetry: vi.fn().mockResolvedValue({ id: "t-1" }),
    addDependency: vi.fn().mockResolvedValue(undefined),
    listPlanVersions: vi.fn().mockResolvedValue([]),
    planUpdateContent: vi.fn().mockResolvedValue(undefined),
  } as unknown as PlanShipStore;
}

describe("PlanShipService — harmonizer fire-and-forget", () => {
  let harmonizerDeferred: {
    resolve: () => void;
    reject: (err: Error) => void;
    promise: Promise<void>;
  };
  let mockSyncPrdFromPlanShip: ReturnType<typeof vi.fn>;
  let deps: PlanShipDeps;
  let service: PlanShipService;

  beforeEach(() => {
    let resolve!: () => void;
    let reject!: (err: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    harmonizerDeferred = { resolve, reject, promise };

    mockSyncPrdFromPlanShip = vi.fn().mockReturnValue(harmonizerDeferred.promise);

    deps = {
      crudService: {
        getPlan: vi.fn().mockResolvedValue(makePlan()),
        clearReviewedAtIfNewTasksAdded: vi.fn().mockResolvedValue(undefined),
      } as unknown as PlanShipDeps["crudService"],
      decomposeService: {
        planTasks: vi.fn(),
        generateAndCreateTasks: vi.fn(),
        autoReviewPlanAgainstRepo: vi.fn(),
      } as unknown as PlanShipDeps["decomposeService"],
      taskStore: makeStore(),
      projectService: {
        getProject: vi.fn().mockResolvedValue({ repoPath: "/tmp/test" }),
        getSettings: vi.fn().mockResolvedValue({}),
      } as unknown as PlanShipDeps["projectService"],
      chatService: {
        syncPrdFromPlanShip: mockSyncPrdFromPlanShip,
      },
      shipPlanDelegate: undefined,
      assembleReExecuteContext: vi.fn().mockResolvedValue({
        fileTree: "",
        keyFilesContent: "",
        completedTasksJson: "[]",
      }),
    };

    service = new PlanShipService(deps);
  });

  it("shipPlan returns before the harmonizer promise resolves", async () => {
    const result = await service.shipPlan("proj-1", "test-plan");

    expect(result.status).toBe("building");
    expect(mockSyncPrdFromPlanShip).toHaveBeenCalledWith(
      "proj-1",
      "test-plan",
      expect.any(String),
      "medium"
    );

    // The harmonizer promise is still pending — shipPlan did NOT wait for it
    harmonizerDeferred.resolve();
  });

  it("shipPlan returns immediately even when the harmonizer is slow", async () => {
    const start = Date.now();
    const result = await service.shipPlan("proj-1", "test-plan");
    const elapsed = Date.now() - start;

    expect(result.status).toBe("building");
    // shipPlan should return in well under a second since harmonizer isn't awaited
    expect(elapsed).toBeLessThan(1000);

    harmonizerDeferred.resolve();
  });

  it("harmonizer errors are caught silently (no unhandled rejection)", async () => {
    const result = await service.shipPlan("proj-1", "test-plan");
    expect(result.status).toBe("building");

    // Reject the harmonizer — this should NOT cause an unhandled rejection
    harmonizerDeferred.reject(new Error("harmonizer agent timeout"));

    // Flush microtasks so the .catch() handler runs
    await new Promise((r) => setTimeout(r, 10));
  });

  it("epic is unblocked (set to open) before harmonizer runs", async () => {
    const callOrder: string[] = [];
    (deps.taskStore.update as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("epicUpdate");
    });
    mockSyncPrdFromPlanShip.mockImplementation(() => {
      callOrder.push("harmonizer");
      return harmonizerDeferred.promise;
    });

    await service.shipPlan("proj-1", "test-plan");

    expect(deps.taskStore.update).toHaveBeenCalledWith("proj-1", "epic-1", { status: "open" });
    expect(callOrder.indexOf("epicUpdate")).toBeLessThan(callOrder.indexOf("harmonizer"));

    harmonizerDeferred.resolve();
  });

  it("shipped content and metadata are set before harmonizer is triggered", async () => {
    const callOrder: string[] = [];
    (deps.taskStore.planSetShippedContent as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        callOrder.push("shippedContent");
      }
    );
    (deps.taskStore.planUpdateMetadata as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("metadata");
    });
    mockSyncPrdFromPlanShip.mockImplementation(() => {
      callOrder.push("harmonizer");
      return harmonizerDeferred.promise;
    });

    await service.shipPlan("proj-1", "test-plan");

    expect(deps.taskStore.planSetShippedContent).toHaveBeenCalled();
    expect(deps.taskStore.planUpdateMetadata).toHaveBeenCalled();
    expect(callOrder.indexOf("shippedContent")).toBeLessThan(callOrder.indexOf("harmonizer"));
    expect(callOrder.indexOf("metadata")).toBeLessThan(callOrder.indexOf("harmonizer"));

    harmonizerDeferred.resolve();
  });
});
