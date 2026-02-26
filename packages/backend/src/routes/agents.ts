import { Router, Request } from "express";
import type { ApiResponse, ActiveAgent } from "@opensprint/shared";
import { orchestratorService } from "../services/orchestrator.service.js";

export const agentsRouter = Router({ mergeParams: true });

type ProjectParams = { projectId: string };
type KillParams = ProjectParams & { agentId: string };

// GET /projects/:projectId/agents/active — List active agents (Build phase from orchestrator)
agentsRouter.get("/active", async (req: Request<ProjectParams>, res, next) => {
  try {
    const agents: ActiveAgent[] = await orchestratorService.getActiveAgents(req.params.projectId);
    const body: ApiResponse<ActiveAgent[]> = { data: agents };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// POST /projects/:projectId/agents/:agentId/kill — Terminate agent process (Execute phase only)
agentsRouter.post("/:agentId/kill", async (req: Request<KillParams>, res, next) => {
  try {
    const { projectId, agentId } = req.params;
    const killed = await orchestratorService.killAgent(projectId, agentId);
    if (!killed) {
      res.status(404).json({ error: "Agent not found or not killable" });
      return;
    }
    res.status(200).json({ data: { killed: true } });
  } catch (err) {
    next(err);
  }
});
