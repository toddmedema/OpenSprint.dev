import { Router, Request } from "express";
import { notificationService } from "../services/notification.service.js";
import type { ApiResponse } from "@opensprint/shared";
import type { Notification } from "../services/notification.service.js";

const projectNotificationsRouter = Router({ mergeParams: true });
const globalNotificationsRouter = Router();

type ProjectParams = { projectId: string };
type NotificationParams = { projectId: string; notificationId: string };

// GET /projects/:projectId/notifications — List unresolved notifications for project
projectNotificationsRouter.get("/", async (req: Request<ProjectParams>, res, next) => {
  try {
    const notifications = await notificationService.listByProject(req.params.projectId);
    const body: ApiResponse<Notification[]> = { data: notifications };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// PATCH /projects/:projectId/notifications/:notificationId — Resolve notification
projectNotificationsRouter.patch(
  "/:notificationId",
  async (req: Request<NotificationParams>, res, next) => {
    try {
      const notification = await notificationService.resolve(
        req.params.projectId,
        req.params.notificationId
      );
      const body: ApiResponse<Notification> = { data: notification };
      res.json(body);
    } catch (err) {
      next(err);
    }
  }
);

// GET /notifications — List unresolved notifications across all projects (global)
globalNotificationsRouter.get("/", async (_req, res, next) => {
  try {
    const notifications = await notificationService.listGlobal();
    const body: ApiResponse<Notification[]> = { data: notifications };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

export { projectNotificationsRouter, globalNotificationsRouter };
