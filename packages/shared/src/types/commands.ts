// ---------------------------------------------------------------------------
// Natural-language command layer types
// ---------------------------------------------------------------------------

/** Risk classification for a command. Determines confirmation UX. */
export type CommandRiskLevel = "safe" | "mutating-low-risk" | "mutating-high-risk";

/** Overall command execution status. */
export type CommandStatus =
  | "interpreting"
  | "previewing"
  | "awaiting_confirmation"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

// ---------------------------------------------------------------------------
// Command intents — discriminated union of supported command types
// ---------------------------------------------------------------------------

export interface ListIntakeIntent {
  commandType: "list_intake";
  args: {
    provider?: string;
    triageStatus?: string;
    search?: string;
    limit?: number;
  };
}

export interface ConvertIntakeIntent {
  commandType: "convert_intake";
  args: {
    itemIds: string[];
    action: string;
    linkTaskId?: string;
  };
}

export interface StartExecuteIntent {
  commandType: "start_execute";
  args: {
    epicId?: string;
    taskIds?: string[];
  };
}

export interface PauseIntegrationIntent {
  commandType: "pause_integration";
  args: {
    provider: string;
  };
}

export interface ResumeIntegrationIntent {
  commandType: "resume_integration";
  args: {
    provider: string;
  };
}

export interface ListTasksIntent {
  commandType: "list_tasks";
  args: {
    status?: string;
    epicId?: string;
    search?: string;
  };
}

export interface CreateTaskIntent {
  commandType: "create_task";
  args: {
    title: string;
    description?: string;
    parentId?: string;
    priority?: number;
  };
}

export interface SyncIntegrationIntent {
  commandType: "sync_integration";
  args: {
    provider: string;
  };
}

export interface ShowProjectStatusIntent {
  commandType: "show_project_status";
  args: Record<string, never>;
}

/** Fallback for unrecognized intents so the interpreter can return structured output. */
export interface UnrecognizedIntent {
  commandType: "unrecognized";
  args: {
    rawInput: string;
    suggestion?: string;
  };
}

/** Union of all supported command intents. */
export type CommandIntent =
  | ListIntakeIntent
  | ConvertIntakeIntent
  | StartExecuteIntent
  | PauseIntegrationIntent
  | ResumeIntegrationIntent
  | ListTasksIntent
  | CreateTaskIntent
  | SyncIntegrationIntent
  | ShowProjectStatusIntent
  | UnrecognizedIntent;

/** Extracts the commandType string literal from the intent union. */
export type CommandType = CommandIntent["commandType"];

// ---------------------------------------------------------------------------
// Interpretation result
// ---------------------------------------------------------------------------

export interface CommandInterpretation {
  intent: CommandIntent;
  confidence: number;
  /** Set when confidence is too low or intent is ambiguous. */
  clarificationNeeded?: string;
  riskLevel: CommandRiskLevel;
}

// ---------------------------------------------------------------------------
// Preview / dry-run
// ---------------------------------------------------------------------------

/** A single mutation that would occur if the command is applied. */
export interface CommandMutation {
  entityType: string;
  entityId?: string;
  operation: "create" | "update" | "delete";
  summary: string;
}

export interface CommandPreview {
  interpretation: CommandInterpretation;
  mutations: CommandMutation[];
  warnings: string[];
  /** Human-readable summary of what will happen. */
  description: string;
}

// ---------------------------------------------------------------------------
// Execution result
// ---------------------------------------------------------------------------

export interface CommandStepResult {
  step: number;
  description: string;
  success: boolean;
  error?: string;
  entityId?: string;
}

export interface CommandExecutionResult {
  success: boolean;
  steps: CommandStepResult[];
  summary: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Persisted command run (audit log)
// ---------------------------------------------------------------------------

export interface CommandRun {
  id: string;
  project_id: string;
  actor: string;
  raw_input: string;
  interpreted_command: CommandIntent | null;
  risk_level: CommandRiskLevel | null;
  status: CommandStatus;
  preview: CommandPreview | null;
  result: CommandExecutionResult | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// API request / response contracts
// ---------------------------------------------------------------------------

/** GET /commands/history */
export interface CommandHistoryFilters {
  limit?: number;
  offset?: number;
  status?: CommandStatus;
}
