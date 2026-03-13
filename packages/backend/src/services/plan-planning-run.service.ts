/**
 * Plan planning runs: create, get latest, assert writable, get plan status (plan/replan/none).
 * Encapsulates planning_runs table and PRD comparison for Sketch CTA; used by PlanService.
 */
import path from "path";
import type { Plan, PlanStatusResponse, Prd } from "@opensprint/shared";
import { OPENSPRINT_PATHS } from "@opensprint/shared";
import { ProjectService } from "./project.service.js";
import { assertMigrationCompleteForResource } from "./migration-guard.service.js";

export interface PlanningRunStore {
  getDb(): Promise<{
    queryOne(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined>;
  }>;
  runWrite<T>(
    fn: (client: { execute: (sql: string, params?: unknown[]) => Promise<number> }) => Promise<T>
  ): Promise<T>;
}

export interface PlanPlanningRunDeps {
  store: PlanningRunStore;
  projectService: ProjectService;
  getPrd: (projectId: string) => Promise<Prd>;
}

export class PlanPlanningRunService {
  constructor(private deps: PlanPlanningRunDeps) {}

  private async getPlanningRunsDir(projectId: string): Promise<string> {
    const project = await this.deps.projectService.getProject(projectId);
    return path.join(project.repoPath, OPENSPRINT_PATHS.planningRuns);
  }

  async assertPlanningRunsWritable(projectId: string): Promise<void> {
    const client = await this.deps.store.getDb();
    const existing = await client.queryOne(
      "SELECT 1 FROM planning_runs WHERE project_id = $1 LIMIT 1",
      [projectId]
    );
    if (existing) return;

    const runsDir = await this.getPlanningRunsDir(projectId);
    await assertMigrationCompleteForResource({
      hasDbRecord: false,
      resource: "Planning runs",
      legacyPaths: [runsDir],
      projectId,
    });
  }

  /** Get the latest planning run (most recent by created_at) */
  async getLatestPlanningRun(projectId: string): Promise<{
    id: string;
    created_at: string;
    prd_snapshot: Prd;
    plans_created: string[];
  } | null> {
    const client = await this.deps.store.getDb();
    const row = await client.queryOne(
      `SELECT id, created_at, prd_snapshot, plans_created
       FROM planning_runs
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [projectId]
    );
    if (!row) {
      const runsDir = await this.getPlanningRunsDir(projectId);
      await assertMigrationCompleteForResource({
        hasDbRecord: false,
        resource: "Planning runs",
        legacyPaths: [runsDir],
        projectId,
      });
      return null;
    }

    let prdSnapshot: Prd;
    try {
      prdSnapshot = JSON.parse(String(row.prd_snapshot ?? "{}")) as Prd;
    } catch {
      prdSnapshot = { version: 0, sections: {}, changeLog: [] } as unknown as Prd;
    }

    let plansCreated: string[] = [];
    try {
      const parsed = JSON.parse(String(row.plans_created ?? "[]")) as unknown;
      if (Array.isArray(parsed)) {
        plansCreated = parsed.filter((item): item is string => typeof item === "string");
      }
    } catch {
      plansCreated = [];
    }

    return {
      id: String(row.id),
      created_at: String(row.created_at),
      prd_snapshot: prdSnapshot,
      plans_created: plansCreated,
    };
  }

  /** Compare two PRDs by section content (ignoring changeLog) */
  prdsEqual(a: Prd, b: Prd): boolean {
    const keys = new Set([...Object.keys(a.sections ?? {}), ...Object.keys(b.sections ?? {})]);
    for (const key of keys) {
      const ac = (a.sections as Record<string, { content?: string }>)?.[key]?.content ?? "";
      const bc = (b.sections as Record<string, { content?: string }>)?.[key]?.content ?? "";
      if (ac !== bc) return false;
    }
    return true;
  }

  /** Get plan status for Sketch CTA (plan/replan/none). PRD §7.1.5 */
  async getPlanStatus(projectId: string): Promise<PlanStatusResponse> {
    const latestRun = await this.getLatestPlanningRun(projectId);
    if (!latestRun) {
      return { hasPlanningRun: false, prdChangedSinceLastRun: false, action: "plan" };
    }
    const currentPrd = await this.deps.getPrd(projectId);
    const prdChanged = !this.prdsEqual(currentPrd, latestRun.prd_snapshot);
    if (!prdChanged) {
      return { hasPlanningRun: true, prdChangedSinceLastRun: false, action: "none" };
    }
    return { hasPlanningRun: true, prdChangedSinceLastRun: true, action: "replan" };
  }

  /** Create a planning run with PRD snapshot. Called after decompose or replan. */
  async createPlanningRun(
    projectId: string,
    plansCreated: Plan[]
  ): Promise<{ id: string; created_at: string }> {
    await this.assertPlanningRunsWritable(projectId);

    const prd = await this.deps.getPrd(projectId);
    const runId = crypto.randomUUID();
    const created_at = new Date().toISOString();
    const run = {
      id: runId,
      created_at,
      prd_snapshot: { ...prd },
      plans_created: plansCreated.map((p) => p.metadata.planId),
    };
    await this.deps.store.runWrite(async (client) => {
      await client.execute(
        `INSERT INTO planning_runs (id, project_id, created_at, prd_snapshot, plans_created)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          run.id,
          projectId,
          run.created_at,
          JSON.stringify(run.prd_snapshot),
          JSON.stringify(run.plans_created),
        ]
      );
    });
    return { id: runId, created_at };
  }
}
