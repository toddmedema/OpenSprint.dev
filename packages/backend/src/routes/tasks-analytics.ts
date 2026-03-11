import { Router } from "express";
import type { TaskService } from "../services/task.service.js";
import type { ApiResponse, TaskAnalytics } from "@opensprint/shared";
import { wrapAsync } from "../middleware/wrap-async.js";

/**
 * Global task analytics router.
 * GET /tasks/analytics — Task analytics (global scope, all projects)
 */
export function createTasksAnalyticsRouter(taskService: TaskService): Router {
  const router = Router();

  router.get(
    "/analytics",
    wrapAsync(async (_req, res) => {
      const analytics = await taskService.getTaskAnalytics();
      const body: ApiResponse<TaskAnalytics> = { data: analytics };
      res.json(body);
    })
  );

  return router;
}
