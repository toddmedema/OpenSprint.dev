import { Router, Request } from "express";
import { notificationService } from "../services/notification.service.js";
import { hilService } from "../services/hil-service.js";
import { taskStore } from "../services/task-store.service.js";
import { broadcastToProject } from "../websocket/index.js";
import { getProvidersRequiringApiKeys } from "@opensprint/shared";
import { ProjectService } from "../services/project.service.js";
import { orchestratorService } from "../services/orchestrator.service.js";
import { getNextKey } from "../services/api-key-resolver.service.js";
import { AppError } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";
import type { ApiResponse } from "@opensprint/shared";
import type { Notification } from "../services/notification.service.js";

const projectServiceInstance = new ProjectService();
const projectNotificationsRouter = Router({ mergeParams: true });
const globalNotificationsRouter = Router();

type ProjectParams = { projectId: string };
type NotificationParams = { projectId: string; notificationId: string };
type ResolveBody = { approved?: boolean };

// POST /projects/:projectId/notifications/:notificationId/retry-rate-limit — Check keys available, resolve rate-limit notifications, nudge orchestrator
projectNotificationsRouter.post(
  "/:notificationId/retry-rate-limit",
  async (req: Request<NotificationParams>, res, next) => {
    try {
      const { projectId, notificationId } = req.params;
      const notifications = await notificationService.listByProject(projectId);
      const notification = notifications.find((n) => n.id === notificationId);
      if (!notification) {
        throw new AppError(
          404,
          ErrorCodes.NOTIFICATION_NOT_FOUND,
          `Notification '${notificationId}' not found`,
          { notificationId, projectId }
        );
      }
      if (notification.kind !== "api_blocked" || notification.errorCode !== "rate_limit") {
        throw new AppError(
          400,
          ErrorCodes.INVALID_INPUT,
          "Retry is only available for rate limit notifications"
        );
      }
      const settings = await projectServiceInstance.getSettings(projectId);
      const providers = getProvidersRequiringApiKeys([
        settings.simpleComplexityAgent,
        settings.complexComplexityAgent,
      ]);
      let hasAvailableKey = false;
      for (const provider of providers) {
        const resolved = await getNextKey(projectId, provider);
        if (resolved) {
          hasAvailableKey = true;
          break;
        }
      }
      if (providers.length > 0 && !hasAvailableKey) {
        throw new AppError(
          400,
          ErrorCodes.INVALID_INPUT,
          "No API keys available. Add more keys in Settings or wait 24h for rate-limited keys to reset."
        );
      }
      const resolved = await notificationService.resolveRateLimitNotifications(projectId);
      for (const r of resolved) {
        broadcastToProject(projectId, {
          type: "notification.resolved",
          notificationId: r.id,
          projectId,
          source: r.source,
          sourceId: r.sourceId,
        });
      }
      orchestratorService.nudge(projectId);
      res.json({
        data: { ok: true, resolvedCount: resolved.length },
      } as ApiResponse<{ ok: boolean; resolvedCount: number }>);
    } catch (err) {
      next(err);
    }
  }
);

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
// Body: { approved?: boolean } for hil_approval notifications (true=approve, false/dismiss=reject)
projectNotificationsRouter.patch(
  "/:notificationId",
  async (req: Request<NotificationParams, unknown, ResolveBody>, res, next) => {
    try {
      const { projectId, notificationId } = req.params;
      const approved = req.body?.approved;
      const notification = await notificationService.resolve(projectId, notificationId);

      // HIL approval: notify waiting workflow of user's choice
      if (notification.kind === "hil_approval") {
        hilService.notifyResolved(notificationId, approved === true);
      }

      broadcastToProject(projectId, {
        type: "notification.resolved",
        notificationId,
        projectId,
        source: notification.source,
        sourceId: notification.sourceId,
      });

      // When source=execute, unblock the task so orchestrator can re-pick it
      if (notification.source === "execute" && notification.sourceId) {
        const taskId = notification.sourceId;
        try {
          await taskStore.update(projectId, taskId, {
            status: "open",
            block_reason: null,
          });
        } catch {
          // Task may not exist or already unblocked
        }
      }

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
