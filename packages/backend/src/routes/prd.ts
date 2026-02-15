import { Router, Request } from 'express';
import { PrdService } from '../services/prd.service.js';
import { ChatService } from '../services/chat.service.js';
import { broadcastToProject } from '../websocket/index.js';
import type { ApiResponse, Prd, PrdSection, PrdChangeLogEntry } from '@opensprint/shared';

const prdService = new PrdService();
const chatService = new ChatService();

export const prdRouter = Router({ mergeParams: true });

type ProjectParams = { projectId: string };
type SectionParams = { projectId: string; section: string };

// GET /projects/:projectId/prd — Get full PRD
prdRouter.get('/', async (req: Request<ProjectParams>, res, next) => {
  try {
    const prd = await prdService.getPrd(req.params.projectId);
    const body: ApiResponse<Prd> = { data: prd };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// GET /projects/:projectId/prd/history — Get PRD change log
prdRouter.get('/history', async (req: Request<ProjectParams>, res, next) => {
  try {
    const changeLog = await prdService.getHistory(req.params.projectId);
    const body: ApiResponse<PrdChangeLogEntry[]> = { data: changeLog };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// GET /projects/:projectId/prd/:section — Get a specific PRD section
prdRouter.get('/:section', async (req: Request<SectionParams>, res, next) => {
  try {
    const section = await prdService.getSection(
      req.params.projectId,
      req.params.section,
    );
    const body: ApiResponse<PrdSection> = { data: section };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// PUT /projects/:projectId/prd/:section — Update a specific PRD section (direct edit)
prdRouter.put('/:section', async (req: Request<SectionParams>, res, next) => {
  try {
    const { content, source } = req.body as { content: string; source?: string };
    const result = await prdService.updateSection(
      req.params.projectId,
      req.params.section,
      content,
      (source as 'design' | 'plan' | 'build' | 'validate') || 'design',
    );

    // Sync direct edit to conversation context (PRD §7.1.5)
    await chatService.addDirectEditMessage(
      req.params.projectId,
      req.params.section,
      content,
    );

    // Broadcast PRD update via WebSocket
    broadcastToProject(req.params.projectId, {
      type: 'prd.updated',
      section: req.params.section,
      version: result.newVersion,
    });

    res.json({
      data: {
        section: result.section,
        previousVersion: result.previousVersion,
        newVersion: result.newVersion,
      },
    });
  } catch (err) {
    next(err);
  }
});
