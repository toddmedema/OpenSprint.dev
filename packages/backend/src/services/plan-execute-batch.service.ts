/**
 * Persisted queue for "Execute all" — processes plan ships sequentially on the server so a UI
 * refresh does not drop remaining plans.
 */
import { randomUUID } from "crypto";
import type { PlanExecuteBatchItem, PlanExecuteBatchStatus } from "@opensprint/shared";
import { broadcastToProject } from "../websocket/index.js";
import { orchestratorService } from "./orchestrator.service.js";
import { taskStore } from "./task-store.service.js";
import type { PlanService } from "./plan.service.js";
import { AppError } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("plan-execute-batch");

const activeBatchRunnerByProject = new Map<string, Promise<void>>();

interface BatchRow {
  id: string;
  project_id: string;
  items_json: string;
  current_index: number;
  status: string;
  error_plan_id: string | null;
  error_message: string | null;
  updated_at: string;
}

function rowToStatus(row: BatchRow): PlanExecuteBatchStatus {
  let items: PlanExecuteBatchItem[] = [];
  try {
    items = JSON.parse(row.items_json) as PlanExecuteBatchItem[];
  } catch {
    items = [];
  }
  const total = items.length;
  const st = row.status as PlanExecuteBatchStatus["status"];
  return {
    batchId: row.id,
    projectId: row.project_id,
    status: st === "completed" || st === "failed" ? st : "running",
    currentIndex: row.current_index,
    total,
    errorPlanId: row.error_plan_id ?? undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

async function shipOne(
  planService: PlanService,
  projectId: string,
  item: PlanExecuteBatchItem
): Promise<void> {
  const prerequisitePlanIds = item.prerequisitePlanIds ?? [];
  const options = item.version_number != null ? { version_number: item.version_number } : undefined;
  if (prerequisitePlanIds.length > 0) {
    await planService.shipPlanWithPrerequisites(
      projectId,
      item.planId,
      prerequisitePlanIds,
      options
    );
  } else {
    await planService.shipPlan(projectId, item.planId, options);
  }
}

function broadcastShip(projectId: string, planId: string, prerequisitePlanIds: string[]): void {
  for (const updatedPlanId of new Set([planId, ...prerequisitePlanIds])) {
    broadcastToProject(projectId, { type: "plan.updated", planId: updatedPlanId });
  }
}

async function runBatchLoop(
  planService: PlanService,
  projectId: string,
  batchId: string
): Promise<void> {
  for (;;) {
    const row = await taskStore.runWrite(async (client) => {
      const r = await client.queryOne(
        "SELECT id, project_id, items_json, current_index, status, error_plan_id, error_message, updated_at FROM plan_execute_batches WHERE id = $1",
        [batchId]
      );
      return r as unknown as BatchRow | null;
    });

    if (!row || row.project_id !== projectId) return;
    if (row.status !== "running") return;

    let items: PlanExecuteBatchItem[] = [];
    try {
      items = JSON.parse(row.items_json) as PlanExecuteBatchItem[];
    } catch (err) {
      log.error("Invalid items_json in plan_execute_batches", { batchId, err });
      await taskStore.runWrite(async (client) => {
        await client.execute(
          "UPDATE plan_execute_batches SET status = $1, error_message = $2, updated_at = $3 WHERE id = $4",
          ["failed", "Invalid batch payload", new Date().toISOString(), batchId]
        );
      });
      return;
    }

    if (row.current_index >= items.length) {
      await taskStore.runWrite(async (client) => {
        await client.execute(
          "UPDATE plan_execute_batches SET status = $1, updated_at = $2 WHERE id = $3",
          ["completed", new Date().toISOString(), batchId]
        );
      });
      return;
    }

    const item = items[row.current_index]!;
    try {
      await shipOne(planService, projectId, item);
      broadcastShip(projectId, item.planId, item.prerequisitePlanIds ?? []);
      orchestratorService.nudge(projectId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("Plan execute batch item failed", { projectId, batchId, planId: item.planId, err });
      await taskStore.runWrite(async (client) => {
        await client.execute(
          "UPDATE plan_execute_batches SET status = $1, error_plan_id = $2, error_message = $3, updated_at = $4 WHERE id = $5",
          ["failed", item.planId, message, new Date().toISOString(), batchId]
        );
      });
      return;
    }

    const nextIndex = row.current_index + 1;
    const now = new Date().toISOString();
    await taskStore.runWrite(async (client) => {
      if (nextIndex >= items.length) {
        await client.execute(
          "UPDATE plan_execute_batches SET status = $1, current_index = $2, updated_at = $3 WHERE id = $4",
          ["completed", nextIndex, now, batchId]
        );
      } else {
        await client.execute(
          "UPDATE plan_execute_batches SET current_index = $1, updated_at = $2 WHERE id = $3",
          [nextIndex, now, batchId]
        );
      }
    });
  }
}

function scheduleBatchRun(planService: PlanService, projectId: string, batchId: string): void {
  if (activeBatchRunnerByProject.has(projectId)) return;
  const promise = runBatchLoop(planService, projectId, batchId).finally(() => {
    activeBatchRunnerByProject.delete(projectId);
  });
  activeBatchRunnerByProject.set(projectId, promise);
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  if (e.code === "23505") return true;
  if (typeof e.message === "string" && e.message.includes("UNIQUE constraint failed")) return true;
  if (typeof e.message === "string" && e.message.includes("duplicate key")) return true;
  return false;
}

/**
 * Enqueue a batch and start processing. At most one running batch per project (DB-enforced).
 */
export async function enqueuePlanExecuteBatch(
  planService: PlanService,
  projectId: string,
  items: PlanExecuteBatchItem[]
): Promise<{ batchId: string }> {
  if (items.length === 0) {
    throw new AppError(400, ErrorCodes.INVALID_INPUT, "items must not be empty");
  }

  const batchId = randomUUID();
  const now = new Date().toISOString();

  try {
    await taskStore.runWrite(async (client) => {
      await client.execute(
        `INSERT INTO plan_execute_batches (id, project_id, items_json, current_index, status, error_plan_id, error_message, updated_at)
         VALUES ($1, $2, $3, 0, 'running', NULL, NULL, $4)`,
        [batchId, projectId, JSON.stringify(items), now]
      );
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(
        409,
        ErrorCodes.PLAN_EXECUTE_BATCH_IN_PROGRESS,
        "A plan execute batch is already running for this project"
      );
    }
    throw err;
  }

  scheduleBatchRun(planService, projectId, batchId);
  return { batchId };
}

/** Latest running batch for a project, if any. */
export async function getActivePlanExecuteBatch(
  projectId: string
): Promise<PlanExecuteBatchStatus | null> {
  const client = await taskStore.getDb();
  const row = await client.queryOne(
    "SELECT id, project_id, items_json, current_index, status, error_plan_id, error_message, updated_at FROM plan_execute_batches WHERE project_id = $1 AND status = $2 ORDER BY updated_at DESC LIMIT 1",
    [projectId, "running"]
  );
  if (!row) return null;
  return rowToStatus(row as unknown as BatchRow);
}

export async function getPlanExecuteBatchStatus(
  projectId: string,
  batchId: string
): Promise<PlanExecuteBatchStatus | null> {
  const client = await taskStore.getDb();
  const row = await client.queryOne(
    "SELECT id, project_id, items_json, current_index, status, error_plan_id, error_message, updated_at FROM plan_execute_batches WHERE id = $1 AND project_id = $2",
    [batchId, projectId]
  );
  if (!row) return null;
  return rowToStatus(row as unknown as BatchRow);
}

/**
 * Resume batches left in `running` after a process crash (best-effort).
 */
export async function resumePlanExecuteBatchesOnStartup(planService: PlanService): Promise<void> {
  const client = await taskStore.getDb();
  const rows = await client.query(
    "SELECT id, project_id FROM plan_execute_batches WHERE status = $1",
    ["running"]
  );
  for (const r of rows) {
    const projectId = String((r as { project_id?: unknown }).project_id ?? "");
    const batchId = String((r as { id?: unknown }).id ?? "");
    if (!projectId || !batchId) continue;
    log.info("Resuming plan execute batch after startup", { projectId, batchId });
    scheduleBatchRun(planService, projectId, batchId);
  }
}
