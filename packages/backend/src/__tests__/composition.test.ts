import { afterEach, describe, expect, it, vi } from "vitest";
import { API_PREFIX } from "@opensprint/shared";
import { createApp } from "../app.js";
import { createAppServices, type AppServices } from "../composition.js";
import { databaseRuntime } from "../services/database-runtime.service.js";
import { orchestratorService } from "../services/orchestrator.service.js";
import { agentInstructionsService } from "../services/agent-instructions.service.js";
import { authedSupertest } from "./local-auth-test-helpers.js";

function createInjectedServices(): AppServices {
  const project = {
    id: "proj-1",
    name: "Injected Project",
    repoPath: "/tmp/injected-project",
  };
  const prd = {
    version: 0,
    sections: {},
    changeLog: [],
  };

  return {
    taskService: {} as AppServices["taskService"],
    sessionManager: {} as AppServices["sessionManager"],
    projectService: {
      listProjects: vi.fn().mockResolvedValue([]),
      getProject: vi.fn().mockResolvedValue(project),
    } as unknown as AppServices["projectService"],
    planService: {
      getPlanStatus: vi.fn().mockResolvedValue({
        hasPlanningRun: false,
        prdChangedSinceLastRun: false,
        action: "plan",
      }),
      hasExistingCode: vi.fn().mockResolvedValue(false),
    } as unknown as AppServices["planService"],
    prdService: {
      getPrd: vi.fn().mockResolvedValue(prd),
      getHistory: vi.fn().mockResolvedValue([]),
      getSnapshot: vi.fn().mockResolvedValue(null),
      listSnapshotVersions: vi.fn().mockResolvedValue([]),
      getSection: vi.fn().mockResolvedValue({ content: "", version: 0, updatedAt: null }),
      updateSection: vi.fn(),
    } as unknown as AppServices["prdService"],
    chatService: {
      getHistory: vi.fn().mockResolvedValue({ context: "sketch", messages: [] }),
      sendMessage: vi.fn(),
      addDirectEditMessage: vi.fn(),
    } as unknown as AppServices["chatService"],
    feedbackService: {
      listFeedback: vi.fn().mockResolvedValue([]),
      submitFeedback: vi.fn(),
      getFeedback: vi.fn(),
      recategorizeFeedback: vi.fn(),
      resolveFeedback: vi.fn(),
      cancelFeedback: vi.fn(),
    } as unknown as AppServices["feedbackService"],
    agentInstructionsService: {
      getGeneralInstructions: vi.fn().mockResolvedValue("# Injected instructions"),
      setGeneralInstructions: vi.fn(),
      getRoleInstructions: vi.fn().mockResolvedValue(""),
      setRoleInstructions: vi.fn(),
    } as unknown as AppServices["agentInstructionsService"],
  };
}

describe("composition", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createApp routes use injected dependencies instead of route-local construction", async () => {
    vi.spyOn(databaseRuntime, "requireDatabase").mockResolvedValue(undefined);
    const services = createInjectedServices();
    const app = createApp(services);

    await authedSupertest(app).get(`${API_PREFIX}/projects/proj-1`).expect(200);
    await authedSupertest(app).get(`${API_PREFIX}/projects/proj-1/prd`).expect(200);
    await authedSupertest(app)
      .get(`${API_PREFIX}/projects/proj-1/chat/history?context=sketch`)
      .expect(200);
    await authedSupertest(app).get(`${API_PREFIX}/projects/proj-1/agents/instructions`).expect(200);
    await authedSupertest(app).get(`${API_PREFIX}/projects/proj-1/feedback`).expect(200);

    expect(services.projectService.getProject).toHaveBeenCalledWith("proj-1");
    expect(services.prdService.getPrd).toHaveBeenCalledWith("proj-1");
    expect(services.chatService.getHistory).toHaveBeenCalledWith("proj-1", "sketch");
    expect(services.agentInstructionsService.getGeneralInstructions).toHaveBeenCalledWith("proj-1");
    expect(services.feedbackService.listFeedback).toHaveBeenCalledWith("proj-1", undefined);
  });

  it("createAppServices preserves intentional singleton wiring", () => {
    const setSessionManagerSpy = vi.spyOn(orchestratorService, "setSessionManager");

    const services = createAppServices();

    expect(setSessionManagerSpy).toHaveBeenCalledWith(services.sessionManager);
    expect(services.agentInstructionsService).toBe(agentInstructionsService);
  });
});
