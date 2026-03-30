import path from "path";
import fs from "fs/promises";
import express from "express";
import { localhostCors } from "./middleware/cors.js";
import { errorHandler } from "./middleware/error-handler.js";
import { apiErrorNotificationMiddleware } from "./middleware/api-error-notification.js";
import { createProjectsRouter } from "./routes/projects.js";
import { createPrdRouter } from "./routes/prd.js";
import { createPlansRouter } from "./routes/plans.js";
import { createChatRouter } from "./routes/chat.js";
import { createExecuteRouter } from "./routes/execute.js";
import { createDeliverRouter } from "./routes/deliver.js";
import { createAgentsRouter } from "./routes/agents.js";
import { createTasksRouter } from "./routes/tasks.js";
import { createTasksAnalyticsRouter } from "./routes/tasks-analytics.js";
import { createAppServices, type AppServices } from "./composition.js";
import { createFeedbackRouter } from "./routes/feedback.js";
import {
  createProjectNotificationsRouter,
  createGlobalNotificationsRouter,
} from "./routes/notifications.js";
import { fsRouter } from "./routes/fs.js";
import { modelsRouter } from "./routes/models.js";
import { envRouter } from "./routes/env.js";
import { globalSettingsRouter } from "./routes/global-settings.js";
import { helpRouter } from "./routes/help.js";
import { dbStatusRouter } from "./routes/db-status.js";
import { createTodoistIntegrationRouter } from "./routes/integrations-todoist.js";
import { integrationStore } from "./services/integration-store.service.js";
import { tokenEncryption } from "./services/token-encryption.service.js";
import { API_PREFIX } from "@opensprint/shared";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { wrapAsync } from "./middleware/wrap-async.js";
import { requireDatabase } from "./middleware/require-database.js";
import { orchestratorService } from "./services/orchestrator.service.js";
import {
  getLocalSessionToken,
  ensureLocalSessionToken,
} from "./services/local-session-auth.service.js";

export function createApp(services?: AppServices) {
  ensureLocalSessionToken();
  const app = express();
  const svc = services ?? createAppServices();
  const {
    taskService,
    projectService,
    planService,
    prdService,
    chatService,
    feedbackService,
    agentInstructionsService,
    sessionManager,
  } = svc;

  app.use(localhostCors);
  app.use(express.json({ limit: "10mb" }));
  app.use(requestIdMiddleware);

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // API routes (global agents count for desktop tray; must be before /projects so :projectId does not capture "agents")
  // Uses same logic as UI: list projects, then getActiveAgents(projectId) per project and sum (orchestrator + planning agents).
  app.get(
    `${API_PREFIX}/agents/active-count`,
    wrapAsync(async (_req, res) => {
      const projects = await projectService.listProjects();
      let count = 0;
      for (const p of projects) {
        try {
          const agents = await orchestratorService.getActiveAgents(p.id);
          count += agents.length;
        } catch {
          // Skip project if getActiveAgents fails (e.g. project no longer valid)
        }
      }
      res.json({ data: { count } });
    })
  );

  app.use(`${API_PREFIX}/db-status`, dbStatusRouter);
  app.use(`${API_PREFIX}/models`, modelsRouter);
  app.use(`${API_PREFIX}/env`, envRouter);
  app.use(`${API_PREFIX}/tasks`, createTasksAnalyticsRouter(taskService));
  app.use(`${API_PREFIX}/global-settings`, globalSettingsRouter);
  app.use(`${API_PREFIX}/help`, requireDatabase, helpRouter);
  app.use(`${API_PREFIX}/projects/:projectId/plan-status`, requireDatabase);
  app.use(`${API_PREFIX}/projects`, createProjectsRouter(projectService, planService));
  app.use(
    `${API_PREFIX}/projects/:projectId/prd`,
    requireDatabase,
    createPrdRouter({ prdService, chatService })
  );
  app.use(
    `${API_PREFIX}/projects/:projectId/plans`,
    requireDatabase,
    createPlansRouter(planService)
  );
  app.use(
    `${API_PREFIX}/projects/:projectId/chat`,
    requireDatabase,
    createChatRouter({ chatService })
  );
  app.use(
    `${API_PREFIX}/projects/:projectId/execute`,
    requireDatabase,
    createExecuteRouter(taskService, projectService, sessionManager)
  );
  app.use(
    `${API_PREFIX}/projects/:projectId/deliver`,
    requireDatabase,
    createDeliverRouter(projectService)
  );
  app.use(
    `${API_PREFIX}/projects/:projectId/agents`,
    requireDatabase,
    createAgentsRouter({ projectService, orchestratorService, agentInstructionsService })
  );
  app.use(
    `${API_PREFIX}/projects/:projectId/tasks`,
    requireDatabase,
    createTasksRouter(taskService)
  );
  app.use(
    `${API_PREFIX}/projects/:projectId/feedback`,
    requireDatabase,
    createFeedbackRouter({ feedbackService, orchestratorService })
  );
  app.use(
    `${API_PREFIX}/projects/:projectId/integrations/todoist`,
    requireDatabase,
    createTodoistIntegrationRouter({ integrationStore, tokenEncryption })
  );
  app.use(
    `${API_PREFIX}/projects/:projectId/notifications`,
    requireDatabase,
    createProjectNotificationsRouter({ projectService, orchestratorService })
  );
  app.use(`${API_PREFIX}/notifications`, requireDatabase, createGlobalNotificationsRouter());
  app.use(`${API_PREFIX}/fs`, fsRouter);

  // Desktop mode: serve built frontend and SPA fallback (after all API routes so /api and /ws are untouched)
  if (process.env.OPENSPRINT_DESKTOP === "1") {
    const frontendDist = process.env.OPENSPRINT_FRONTEND_DIST;
    if (frontendDist) {
      app.use(express.static(frontendDist));
      app.get("*", async (req, res, next) => {
        if (req.path.startsWith("/api/") || req.path.startsWith("/ws")) {
          next();
          return;
        }
        const indexPath = path.join(frontendDist, "index.html");
        try {
          const html = await fs.readFile(indexPath, "utf8");
          const token = getLocalSessionToken();
          const inject = `<script>window.__OPENSPRINT_LOCAL_SESSION__=${JSON.stringify(token)};</script>`;
          const body = html.includes("</head>")
            ? html.replace("</head>", `${inject}</head>`)
            : `${inject}${html}`;
          res.type("html").send(body);
        } catch (err) {
          next(err);
        }
      });
    }
  }

  // Error handling: API-error notification middleware runs first (creates human-blocked notifications)
  app.use(apiErrorNotificationMiddleware);
  app.use(errorHandler);

  return app;
}
