import fs from 'fs/promises';
import path from 'path';
import type {
  Task,
  AgentSession,
  TaskType,
  TaskPriority,
  BeadsStatus,
  KanbanColumn,
} from '@opensprint/shared';
import { OPENSPRINT_PATHS } from '@opensprint/shared';
import { ProjectService } from './project.service.js';
import { BeadsService, type BeadsIssue } from './beads.service.js';

// ── Transformation helpers ──────────────────────────────────────────

const VALID_TASK_TYPES = new Set<TaskType>(['bug', 'feature', 'task', 'epic', 'chore']);
const VALID_STATUSES = new Set<BeadsStatus>(['open', 'in_progress', 'closed']);

/**
 * Extract epicId from a hierarchical beads ID.
 *   "proj-abc.1"   → "proj-abc"
 *   "proj-abc.1.2" → "proj-abc"
 *   "proj-abc"     → null
 */
function extractEpicId(id: string): string | null {
  const dotIdx = id.indexOf('.', id.lastIndexOf('-') + 1);
  return dotIdx >= 0 ? id.slice(0, dotIdx) : null;
}

/**
 * Map a beads status + readiness into a KanbanColumn.
 *   closed      → done
 *   in_progress → in_progress  (future: check orchestrator phase for in_review)
 *   open + ready → ready
 *   open + blocked → backlog
 *   epic (open) → planning
 */
function computeKanbanColumn(
  issue: BeadsIssue,
  readyIds: Set<string>,
): KanbanColumn {
  const status = issue.status as BeadsStatus;

  if (status === 'closed') return 'done';
  if (status === 'in_progress') return 'in_progress';

  // Epics sit in planning until all their gating tasks are done
  if (issue.issue_type === 'epic') return 'planning';

  // Open non-epic: ready if beads says so, otherwise backlog
  return readyIds.has(issue.id) ? 'ready' : 'backlog';
}

/**
 * Transform a raw BeadsIssue into a full Task with computed fields.
 */
function transformIssue(issue: BeadsIssue, readyIds: Set<string>): Task {
  const taskType = VALID_TASK_TYPES.has(issue.issue_type as TaskType)
    ? (issue.issue_type as TaskType)
    : 'task';

  const status = VALID_STATUSES.has(issue.status as BeadsStatus)
    ? (issue.status as BeadsStatus)
    : 'open';

  return {
    id: issue.id,
    title: issue.title,
    description: issue.description ?? '',
    type: taskType,
    status,
    priority: (issue.priority ?? 2) as TaskPriority,
    assignee: issue.assignee ?? null,
    labels: issue.labels ?? [],
    dependencies: [], // populated per-task in getTask()
    epicId: extractEpicId(issue.id),
    kanbanColumn: computeKanbanColumn(issue, readyIds),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
  };
}

// ── Service ─────────────────────────────────────────────────────────

export class TaskService {
  private projectService = new ProjectService();
  private beads = new BeadsService();

  /** List all tasks for a project (wraps bd list + bd ready) */
  async listTasks(projectId: string): Promise<Task[]> {
    const project = await this.projectService.getProject(projectId);

    // Fetch all issues and the ready set in parallel
    const [allIssues, readyIssues] = await Promise.all([
      this.beads.list(project.repoPath),
      this.beads.ready(project.repoPath).catch(() => [] as BeadsIssue[]),
    ]);

    const readyIds = new Set(readyIssues.map((i) => i.id));
    return allIssues.map((issue) => transformIssue(issue, readyIds));
  }

  /** Get ready tasks (wraps bd ready --json) */
  async getReadyTasks(projectId: string): Promise<Task[]> {
    const project = await this.projectService.getProject(projectId);
    const readyIssues = await this.beads.ready(project.repoPath);
    const readyIds = new Set(readyIssues.map((i) => i.id));
    return readyIssues.map((issue) => transformIssue(issue, readyIds));
  }

  /** Get a single task with full details (wraps bd show --json) */
  async getTask(projectId: string, taskId: string): Promise<Task> {
    const project = await this.projectService.getProject(projectId);

    // Fetch task detail and ready set in parallel
    const [issue, readyIssues] = await Promise.all([
      this.beads.show(project.repoPath, taskId),
      this.beads.ready(project.repoPath).catch(() => [] as BeadsIssue[]),
    ]);

    const readyIds = new Set(readyIssues.map((i) => i.id));
    return transformIssue(issue, readyIds);
  }

  /** Get all agent sessions for a task */
  async getTaskSessions(projectId: string, taskId: string): Promise<AgentSession[]> {
    const project = await this.projectService.getProject(projectId);
    const sessionsDir = path.join(project.repoPath, OPENSPRINT_PATHS.sessions);
    const sessions: AgentSession[] = [];

    try {
      const files = await fs.readdir(sessionsDir);
      for (const file of files) {
        if (file.startsWith(`${taskId}-`) && file.endsWith('.json')) {
          const data = await fs.readFile(path.join(sessionsDir, file), 'utf-8');
          sessions.push(JSON.parse(data) as AgentSession);
        }
      }
    } catch {
      // No sessions directory yet
    }

    return sessions.sort((a, b) => a.attempt - b.attempt);
  }

  /** Get a specific agent session for a task */
  async getTaskSession(
    projectId: string,
    taskId: string,
    attempt: number,
  ): Promise<AgentSession> {
    const project = await this.projectService.getProject(projectId);
    const sessionPath = path.join(
      project.repoPath,
      OPENSPRINT_PATHS.sessions,
      `${taskId}-${attempt}.json`,
    );
    const data = await fs.readFile(sessionPath, 'utf-8');
    return JSON.parse(data) as AgentSession;
  }
}
