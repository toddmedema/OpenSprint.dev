import { Router, Request } from "express";
import { PlanService } from "../services/plan.service.js";
import type { ApiResponse, Plan, PlanDependencyGraph } from "@opensprint/shared";

const planService = new PlanService();

export const plansRouter = Router({ mergeParams: true });

type ProjectParams = { projectId: string };
type PlanParams = { projectId: string; planId: string };

// POST /projects/:projectId/plans/decompose — AI decompose PRD into plans + tasks (must be before :planId)
plansRouter.post("/decompose", async (req: Request<ProjectParams>, res, next) => {
  try {
    const result = await planService.decomposeFromPrd(req.params.projectId);
    const body: ApiResponse<{ created: number; plans: Plan[] }> = { data: result };
    res.status(201).json(body);
  } catch (err) {
    next(err);
  }
});

// GET /projects/:projectId/plans — List all Plans with dependency graph (single call)
plansRouter.get("/", async (req: Request<ProjectParams>, res, next) => {
  try {
    const graph = await planService.listPlansWithDependencyGraph(req.params.projectId);
    const body: ApiResponse<PlanDependencyGraph> = { data: graph };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// POST /projects/:projectId/plans — Create a new Plan
plansRouter.post("/", async (req: Request<ProjectParams>, res, next) => {
  try {
    const plan = await planService.createPlan(req.params.projectId, req.body);
    const body: ApiResponse<Plan> = { data: plan };
    res.status(201).json(body);
  } catch (err) {
    next(err);
  }
});

// GET /projects/:projectId/plans/dependencies — Get dependency graph
plansRouter.get("/dependencies", async (req: Request<ProjectParams>, res, next) => {
  try {
    const graph = await planService.getDependencyGraph(req.params.projectId);
    const body: ApiResponse<PlanDependencyGraph> = { data: graph };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// GET /projects/:projectId/plans/:planId — Get Plan details
plansRouter.get("/:planId", async (req: Request<PlanParams>, res, next) => {
  try {
    const plan = await planService.getPlan(req.params.projectId, req.params.planId);
    const body: ApiResponse<Plan> = { data: plan };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// PUT /projects/:projectId/plans/:planId — Update Plan markdown
plansRouter.put("/:planId", async (req: Request<PlanParams>, res, next) => {
  try {
    const plan = await planService.updatePlan(req.params.projectId, req.params.planId, req.body);
    const body: ApiResponse<Plan> = { data: plan };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// POST /projects/:projectId/plans/:planId/ship — Build It! (approve Plan for build)
plansRouter.post("/:planId/ship", async (req: Request<PlanParams>, res, next) => {
  try {
    const plan = await planService.shipPlan(req.params.projectId, req.params.planId);
    const body: ApiResponse<Plan> = { data: plan };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// POST /projects/:projectId/plans/:planId/reship — Rebuild an updated Plan
plansRouter.post("/:planId/reship", async (req: Request<PlanParams>, res, next) => {
  try {
    const plan = await planService.reshipPlan(req.params.projectId, req.params.planId);
    const body: ApiResponse<Plan> = { data: plan };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
