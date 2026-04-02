import { Router, Request } from "express";
import { wrapAsync } from "../middleware/wrap-async.js";
import { validateParams } from "../middleware/validate.js";
import { projectIdParamSchema, taskIdParamSchema } from "../schemas/request-common.js";
import { orchestratorService } from "../services/orchestrator.service.js";
import type { ProjectService } from "../services/project.service.js";
import type { SessionManager } from "../services/session-manager.js";
import type { ApiResponse, OrchestratorStatus, TaskExecutionDiagnostics } from "@opensprint/shared";
import { taskStore } from "../services/task-store.service.js";
import { TaskExecutionDiagnosticsService } from "../services/task-execution-diagnostics.service.js";

export function createExecuteRouter(
  projectService: ProjectService,
  sessionManager: SessionManager
): Router {
  const router = Router({ mergeParams: true });
  const diagnosticsService = new TaskExecutionDiagnosticsService(
    projectService,
    taskStore,
    sessionManager
  );

  type ProjectParams = { projectId: string };
  type PrepareParams = { projectId: string; taskId: string };

  // GET /projects/:projectId/execute/status — Get orchestrator status
  router.get(
    "/status",
    validateParams(projectIdParamSchema),
    wrapAsync(async (req: Request<ProjectParams>, res) => {
      const status = await orchestratorService.getStatus(req.params.projectId);
      const body: ApiResponse<OrchestratorStatus> = { data: status };
      res.json(body);
    })
  );

  // GET /projects/:projectId/execute/tasks/:taskId/output — Get live output for in-progress task (backfill)
  router.get(
    "/tasks/:taskId/output",
    validateParams(taskIdParamSchema),
    wrapAsync(async (req: Request<PrepareParams>, res) => {
      const { projectId, taskId } = req.params;
      const output = await orchestratorService.getLiveOutput(projectId, taskId);
      const body: ApiResponse<{ output: string }> = { data: { output } };
      res.json(body);
    })
  );

  router.get(
    "/tasks/:taskId/diagnostics",
    validateParams(taskIdParamSchema),
    wrapAsync(async (req: Request<PrepareParams>, res) => {
      const { projectId, taskId } = req.params;
      const diagnostics = await diagnosticsService.getDiagnostics(projectId, taskId);
      const body: ApiResponse<TaskExecutionDiagnostics> = { data: diagnostics };
      res.json(body);
    })
  );

  return router;
}
