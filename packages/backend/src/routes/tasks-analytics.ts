import { Router } from "express";
import type { TaskService } from "../services/task.service.js";
import type { ApiResponse, TaskAnalytics } from "@opensprint/shared";

/**
 * Global task analytics router.
 * GET /tasks/analytics — Task analytics (global scope, all projects)
 */
export function createTasksAnalyticsRouter(taskService: TaskService): Router {
  const router = Router();

  router.get("/analytics", async (_req, res, next) => {
    try {
      const analytics = await taskService.getTaskAnalytics();
      const body: ApiResponse<TaskAnalytics> = { data: analytics };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
