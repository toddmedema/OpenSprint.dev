import type { TaskExecutionPhase, TaskLastExecutionSummary } from "@opensprint/shared";

interface TaskStoreUpdateLike {
  update(
    projectId: string,
    taskId: string,
    fields: {
      extra?: Record<string, unknown>;
    }
  ): Promise<unknown>;
}

export function compactExecutionText(text: string | null | undefined, limit = 300): string {
  if (!text) return "";
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return compact.slice(0, Math.max(0, limit - 3)).trimEnd() + "...";
}

export function buildTaskLastExecutionSummary(params: {
  at?: string;
  attempt: number;
  outcome: TaskLastExecutionSummary["outcome"];
  phase: TaskExecutionPhase;
  summary: string;
  failureType?: string | null;
  blockReason?: string | null;
}): TaskLastExecutionSummary {
  return {
    at: params.at ?? new Date().toISOString(),
    attempt: params.attempt,
    outcome: params.outcome,
    phase: params.phase,
    summary: compactExecutionText(params.summary, 500),
    failureType: params.failureType ?? null,
    blockReason: params.blockReason ?? null,
  };
}

export async function persistTaskLastExecutionSummary(
  taskStore: TaskStoreUpdateLike,
  projectId: string,
  taskId: string,
  summary: TaskLastExecutionSummary
): Promise<void> {
  await taskStore.update(projectId, taskId, {
    extra: {
      last_execution_summary: summary,
    },
  });
}

export function parseTaskLastExecutionSummary(value: unknown): TaskLastExecutionSummary | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.at !== "string" ||
    typeof raw.attempt !== "number" ||
    typeof raw.outcome !== "string" ||
    typeof raw.phase !== "string" ||
    typeof raw.summary !== "string"
  ) {
    return null;
  }
  return {
    at: raw.at,
    attempt: raw.attempt,
    outcome: raw.outcome as TaskLastExecutionSummary["outcome"],
    phase: raw.phase as TaskExecutionPhase,
    summary: raw.summary,
    failureType: typeof raw.failureType === "string" ? raw.failureType : null,
    blockReason: typeof raw.blockReason === "string" ? raw.blockReason : null,
  };
}
