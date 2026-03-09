import path from "path";
import express from "express";
import cors from "cors";
import { errorHandler } from "./middleware/error-handler.js";
import { apiErrorNotificationMiddleware } from "./middleware/api-error-notification.js";
import { projectsRouter } from "./routes/projects.js";
import { prdRouter } from "./routes/prd.js";
import { plansRouter } from "./routes/plans.js";
import { chatRouter } from "./routes/chat.js";
import { createExecuteRouter } from "./routes/execute.js";
import { deliverRouter } from "./routes/deliver.js";
import { agentsRouter } from "./routes/agents.js";
import { createTasksRouter } from "./routes/tasks.js";
import { createTasksAnalyticsRouter } from "./routes/tasks-analytics.js";
import { createAppServices } from "./composition.js";
import { feedbackRouter } from "./routes/feedback.js";
import { projectNotificationsRouter, globalNotificationsRouter } from "./routes/notifications.js";
import { fsRouter } from "./routes/fs.js";
import { modelsRouter } from "./routes/models.js";
import { envRouter } from "./routes/env.js";
import { globalSettingsRouter } from "./routes/global-settings.js";
import { helpRouter } from "./routes/help.js";
import { dbStatusRouter } from "./routes/db-status.js";
import { API_PREFIX } from "@opensprint/shared";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { requireDatabase } from "./middleware/require-database.js";
import { activeAgentsService } from "./services/active-agents.service.js";

export function createApp() {
  const app = express();
  const { taskService, projectService } = createAppServices();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(requestIdMiddleware);

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // API routes (global agents count for desktop tray; must be before /projects so :projectId does not capture "agents")
  app.get(`${API_PREFIX}/agents/active-count`, (_req, res) => {
    const count = activeAgentsService.list().length;
    res.json({ data: { count } });
  });

  app.use(`${API_PREFIX}/db-status`, dbStatusRouter);
  app.use(`${API_PREFIX}/models`, modelsRouter);
  app.use(`${API_PREFIX}/env`, envRouter);
  app.use(`${API_PREFIX}/tasks`, createTasksAnalyticsRouter(taskService));
  app.use(`${API_PREFIX}/global-settings`, globalSettingsRouter);
  app.use(`${API_PREFIX}/help`, requireDatabase, helpRouter);
  app.use(`${API_PREFIX}/projects/:projectId/plan-status`, requireDatabase);
  app.use(`${API_PREFIX}/projects`, projectsRouter);
  app.use(`${API_PREFIX}/projects/:projectId/prd`, requireDatabase, prdRouter);
  app.use(`${API_PREFIX}/projects/:projectId/plans`, requireDatabase, plansRouter);
  app.use(`${API_PREFIX}/projects/:projectId/chat`, requireDatabase, chatRouter);
  app.use(
    `${API_PREFIX}/projects/:projectId/execute`,
    requireDatabase,
    createExecuteRouter(taskService, projectService)
  );
  app.use(`${API_PREFIX}/projects/:projectId/deliver`, requireDatabase, deliverRouter);
  app.use(`${API_PREFIX}/projects/:projectId/agents`, requireDatabase, agentsRouter);
  app.use(
    `${API_PREFIX}/projects/:projectId/tasks`,
    requireDatabase,
    createTasksRouter(taskService)
  );
  app.use(`${API_PREFIX}/projects/:projectId/feedback`, requireDatabase, feedbackRouter);
  app.use(
    `${API_PREFIX}/projects/:projectId/notifications`,
    requireDatabase,
    projectNotificationsRouter
  );
  app.use(`${API_PREFIX}/notifications`, requireDatabase, globalNotificationsRouter);
  app.use(`${API_PREFIX}/fs`, fsRouter);

  // Desktop mode: serve built frontend and SPA fallback (after all API routes so /api and /ws are untouched)
  if (process.env.OPENSPRINT_DESKTOP === "1") {
    const frontendDist = process.env.OPENSPRINT_FRONTEND_DIST;
    if (frontendDist) {
      app.use(express.static(frontendDist));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(frontendDist, "index.html"));
      });
    }
  }

  // Error handling: API-error notification middleware runs first (creates human-blocked notifications)
  app.use(apiErrorNotificationMiddleware);
  app.use(errorHandler);

  return app;
}
