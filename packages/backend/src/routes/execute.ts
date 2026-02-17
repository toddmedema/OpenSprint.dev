import { Router, Request } from 'express';
import { orchestratorService } from '../services/orchestrator.service.js';
import { TaskService } from '../services/task.service.js';
import type { ApiResponse, OrchestratorStatus } from '@opensprint/shared';

const taskService = new TaskService();

export const executeRouter = Router({ mergeParams: true });

type ProjectParams = { projectId: string };
type PrepareParams = { projectId: string; taskId: string };

// POST /projects/:projectId/execute/tasks/:taskId/prepare — Create task directory and prompt (PRD §12.2)
executeRouter.post('/tasks/:taskId/prepare', async (req: Request<PrepareParams>, res, next) => {
  try {
    const { projectId, taskId } = req.params;
    const taskDir = await taskService.prepareTaskDirectory(projectId, taskId, {
      phase: (req.body?.phase as 'coding' | 'review') || 'coding',
      createBranch: req.body?.createBranch !== false,
      attempt: req.body?.attempt ?? 1,
    });
    const body: ApiResponse<{ taskDir: string }> = { data: { taskDir } };
    res.status(201).json(body);
  } catch (err) {
    next(err);
  }
});

// POST /projects/:projectId/execute/nudge — Event-driven dispatch trigger (PRDv2 §5.7)
executeRouter.post('/nudge', async (req: Request<ProjectParams>, res, next) => {
  try {
    const { projectId } = req.params;
    orchestratorService.nudge(projectId);
    const status = await orchestratorService.getStatus(projectId);
    const body: ApiResponse<OrchestratorStatus> = { data: status };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// GET /projects/:projectId/execute/status — Get orchestrator status
executeRouter.get('/status', async (req: Request<ProjectParams>, res, next) => {
  try {
    const status = await orchestratorService.getStatus(req.params.projectId);
    const body: ApiResponse<OrchestratorStatus> = { data: status };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// POST /projects/:projectId/execute/pause — Pause orchestrator (placeholder; PRD §5.7 always-on)
executeRouter.post('/pause', async (req: Request<ProjectParams>, res) => {
  res.status(501).json({
    error: { code: 'NOT_IMPLEMENTED', message: 'Pause not yet supported; orchestrator is always-on' },
  });
});
