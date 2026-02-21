/** Beads issue types */
export type TaskType = "bug" | "feature" | "task" | "epic" | "chore";

/** Beads status values */
export type BeadsStatus = "open" | "in_progress" | "closed";

/** Display status on the kanban board */
export type KanbanColumn =
  | "planning"
  | "backlog"
  | "ready"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked";

/** Beads priority (0 = highest, 4 = lowest) */
export type TaskPriority = 0 | 1 | 2 | 3 | 4;

/** Minimal task fields stored in the global task registry (cross-phase cache). */
export interface TaskSummary {
  title: string;
  kanbanColumn: KanbanColumn;
  priority: TaskPriority;
}

/** Map beads status string to kanban column. Shared so execute and taskRegistry stay in sync. */
export function mapStatusToKanban(status: string): KanbanColumn {
  switch (status) {
    case "open":
      return "backlog";
    case "in_progress":
      return "in_progress";
    case "closed":
      return "done";
    case "blocked":
      return "blocked";
    default:
      return "backlog";
  }
}

/** Task entity — maps to a beads issue */
export interface Task {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  status: BeadsStatus;
  priority: TaskPriority;
  assignee: string | null;
  labels: string[];
  dependencies: TaskDependency[];
  epicId: string | null;
  /** Computed kanban column based on beads state + orchestrator phase */
  kanbanColumn: KanbanColumn;
  createdAt: string;
  updatedAt: string;
  /** Latest test results from agent sessions (PRD §8.3) */
  testResults?: { passed: number; failed: number; skipped: number; total: number } | null;
  /** Feedback item ID when task originates from Evaluate feedback (discovered-from provenance) */
  sourceFeedbackId?: string;
}

/** Dependency relationship between tasks */
export interface TaskDependency {
  targetId: string;
  type: "blocks" | "related" | "parent-child" | "discovered-from";
}
