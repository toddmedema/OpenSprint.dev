import { Router, Request } from 'express';
import { orchestratorService } from '../services/orchestrator.service.js';
import type { ApiResponse, OrchestratorStatus } from '@opensprint/shared';

export const buildRouter = Router({ mergeParams: true });

type ProjectParams = { projectId: string };

// POST /projects/:projectId/build/start — Start the build orchestrator
buildRouter.post('/start', async (req: Request<ProjectParams>, res, next) => {
  try {
    const status = await orchestratorService.start(req.params.projectId);
    const body: ApiResponse<OrchestratorStatus> = { data: status };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// POST /projects/:projectId/build/pause — Pause the build orchestrator
buildRouter.post('/pause', async (req: Request<ProjectParams>, res, next) => {
  try {
    const status = await orchestratorService.pause(req.params.projectId);
    const body: ApiResponse<OrchestratorStatus> = { data: status };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// GET /projects/:projectId/build/status — Get orchestrator status
buildRouter.get('/status', async (req: Request<ProjectParams>, res, next) => {
  try {
    const status = await orchestratorService.getStatus(req.params.projectId);
    const body: ApiResponse<OrchestratorStatus> = { data: status };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
