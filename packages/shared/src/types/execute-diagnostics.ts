export type TaskExecutionPhase = "coding" | "review" | "merge" | "orchestrator";

export type TaskExecutionOutcome =
  | "running"
  | "failed"
  | "rejected"
  | "requeued"
  | "demoted"
  | "blocked"
  | "completed";

export interface TaskLastExecutionSummary {
  at: string;
  attempt: number;
  outcome: Extract<
    TaskExecutionOutcome,
    "failed" | "rejected" | "requeued" | "demoted" | "blocked"
  >;
  phase: TaskExecutionPhase;
  failureType?: string | null;
  blockReason?: string | null;
  summary: string;
}

export interface TaskExecutionEventItem {
  at: string;
  attempt: number | null;
  phase: TaskExecutionPhase;
  outcome: TaskExecutionOutcome;
  title: string;
  summary: string;
  failureType?: string | null;
  blockReason?: string | null;
  mergeStage?: string | null;
  conflictedFiles?: string[];
  model?: string | null;
  nextAction?: string | null;
}

export interface TaskExecutionAttemptItem {
  attempt: number;
  startedAt?: string | null;
  completedAt?: string | null;
  codingModel?: string | null;
  reviewModel?: string | null;
  finalPhase: TaskExecutionPhase;
  finalOutcome: TaskExecutionOutcome;
  finalSummary: string;
  failureType?: string | null;
  blockReason?: string | null;
  mergeStage?: string | null;
  conflictedFiles?: string[];
  sessionAttemptStatuses: string[];
}

export interface TaskExecutionDiagnostics {
  taskId: string;
  taskStatus: string;
  blockReason?: string | null;
  cumulativeAttempts: number;
  latestSummary: string | null;
  latestFailureType?: string | null;
  latestOutcome: TaskExecutionOutcome | null;
  latestNextAction?: string | null;
  attempts: TaskExecutionAttemptItem[];
  timeline: TaskExecutionEventItem[];
}
