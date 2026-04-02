import { ProjectService } from "./services/project.service.js";
import { taskStore } from "./services/task-store.service.js";
import { FeedbackService } from "./services/feedback.service.js";
import { SessionManager } from "./services/session-manager.js";
import { PlanService } from "./services/plan.service.js";
import { PrdService } from "./services/prd.service.js";
import { ChatService } from "./services/chat.service.js";
import { BranchManager } from "./services/branch-manager.js";
import { TaskService } from "./services/task.service.js";
import { orchestratorService } from "./services/orchestrator.service.js";
import { agentInstructionsService } from "./services/agent-instructions.service.js";

export interface AppServices {
  taskService: TaskService;
  projectService: ProjectService;
  planService: PlanService;
  prdService: PrdService;
  chatService: ChatService;
  feedbackService: FeedbackService;
  agentInstructionsService: typeof agentInstructionsService;
  sessionManager: SessionManager;
}

/**
 * Build or obtain single instances of services used by the app.
 * TaskService and routes receive dependencies via this composition root.
 */
export function createAppServices(): AppServices {
  const projectService = new ProjectService();
  const feedbackService = new FeedbackService();
  const prdService = new PrdService();
  const chatService = new ChatService();
  const branchManager = new BranchManager();
  const planService = new PlanService(projectService, taskStore);
  const sessionManager = new SessionManager(projectService);

  if (typeof orchestratorService.setSessionManager === "function") {
    orchestratorService.setSessionManager(sessionManager);
  }

  const taskService = new TaskService(
    projectService,
    taskStore,
    feedbackService,
    sessionManager,
    branchManager,
    orchestratorService
  );

  return {
    taskService,
    projectService,
    planService,
    prdService,
    chatService,
    feedbackService,
    agentInstructionsService,
    sessionManager,
  };
}
