import fs from "fs/promises";
import path from "path";
import type { Task, AgentSession, KanbanColumn, TaskDependency } from "@opensprint/shared";
import { OPENSPRINT_PATHS } from "@opensprint/shared";
import { ProjectService } from "./project.service.js";
import { BeadsService } from "./beads.service.js";
import type { BeadsIssue } from "./beads.service.js";

export class TaskService {
  private projectService = new ProjectService();
  private beads = new BeadsService();

  /** List all tasks for a project with computed kanban columns */
  async listTasks(projectId: string): Promise<Task[]> {
    const project = await this.projectService.getProject(projectId);
    const [allIssues, readyIssues] = await Promise.all([
      this.beads.listAll(project.repoPath),
      this.beads.ready(project.repoPath),
    ]);
    const readyIds = new Set(readyIssues.map((i) => i.id));
    const idToIssue = new Map(allIssues.map((i) => [i.id, i]));

    return allIssues.map((issue) => this.beadsIssueToTask(issue, readyIds, idToIssue));
  }

  /** Get ready tasks (wraps bd ready --json) */
  async getReadyTasks(projectId: string): Promise<Task[]> {
    const project = await this.projectService.getProject(projectId);
    const [readyIssues, allIssues] = await Promise.all([
      this.beads.ready(project.repoPath),
      this.beads.listAll(project.repoPath),
    ]);
    const readyIds = new Set(readyIssues.map((i) => i.id));
    const idToIssue = new Map(allIssues.map((i) => [i.id, i]));
    return readyIssues.map((issue) => this.beadsIssueToTask(issue, readyIds, idToIssue));
  }

  /** Get a single task (wraps bd show --json) */
  async getTask(projectId: string, taskId: string): Promise<Task> {
    const project = await this.projectService.getProject(projectId);
    const [issue, allIssues, readyIssues] = await Promise.all([
      this.beads.show(project.repoPath, taskId),
      this.beads.listAll(project.repoPath),
      this.beads.ready(project.repoPath),
    ]);
    const readyIds = new Set(readyIssues.map((i) => i.id));
    const idToIssue = new Map(allIssues.map((i) => [i.id, i]));
    return this.beadsIssueToTask(issue, readyIds, idToIssue);
  }

  /** Transform beads issue to Task with computed kanbanColumn */
  private beadsIssueToTask(issue: BeadsIssue, readyIds: Set<string>, idToIssue: Map<string, BeadsIssue>): Task {
    const kanbanColumn = this.computeKanbanColumn(issue, readyIds, idToIssue);
    const deps = (issue.dependencies as Array<{ depends_on_id: string; type: string }>) ?? [];
    const epicId = this.extractEpicId(issue.id);

    return {
      id: issue.id,
      title: issue.title ?? "",
      description: (issue.description as string) ?? "",
      type: this.normalizeType((issue.issue_type ?? issue.type) as string | undefined),
      status: (issue.status as "open" | "in_progress" | "closed") ?? "open",
      priority: Math.min(4, Math.max(0, (issue.priority as number) ?? 1)) as 0 | 1 | 2 | 3 | 4,
      assignee: (issue.assignee as string) ?? null,
      labels: (issue.labels as string[]) ?? [],
      dependencies: deps.map((d) => ({ targetId: d.depends_on_id, type: d.type as TaskDependency["type"] })),
      epicId,
      kanbanColumn,
      createdAt: (issue.created_at as string) ?? "",
      updatedAt: (issue.updated_at as string) ?? "",
    };
  }

  private computeKanbanColumn(
    issue: BeadsIssue,
    readyIds: Set<string>,
    idToIssue: Map<string, BeadsIssue>,
  ): KanbanColumn {
    const status = (issue.status as string) ?? "open";

    if (status === "closed") return "done";
    if (status === "in_progress" && issue.assignee) return "in_progress";

    // status === 'open'
    const deps = (issue.dependencies as Array<{ depends_on_id: string; type: string }>) ?? [];
    const blocksDeps = deps.filter((d) => d.type === "blocks");

    for (const d of blocksDeps) {
      const depIssue = idToIssue.get(d.depends_on_id);
      if (!depIssue || (depIssue.status as string) !== "open") continue;
      const isGate = /\.0$/.test(d.depends_on_id);
      if (isGate) return "planning";
      return "backlog";
    }

    return readyIds.has(issue.id) ? "ready" : "backlog";
  }

  private extractEpicId(id: string): string | null {
    const lastDot = id.lastIndexOf(".");
    if (lastDot <= 0) return null;
    return id.slice(0, lastDot);
  }

  private normalizeType(t: string | undefined): Task["type"] {
    const valid: Task["type"][] = ["bug", "feature", "task", "epic", "chore"];
    return (valid.includes(t as Task["type"]) ? t : "task") as Task["type"];
  }

  /** Get all agent sessions for a task */
  async getTaskSessions(projectId: string, taskId: string): Promise<AgentSession[]> {
    const project = await this.projectService.getProject(projectId);
    const sessionsDir = path.join(project.repoPath, OPENSPRINT_PATHS.sessions);
    const sessions: AgentSession[] = [];

    try {
      const files = await fs.readdir(sessionsDir);
      for (const file of files) {
        if (file.startsWith(`${taskId}-`) && file.endsWith(".json")) {
          const data = await fs.readFile(path.join(sessionsDir, file), "utf-8");
          sessions.push(JSON.parse(data) as AgentSession);
        }
      }
    } catch {
      // No sessions directory yet
    }

    return sessions.sort((a, b) => a.attempt - b.attempt);
  }

  /** Get a specific agent session for a task */
  async getTaskSession(projectId: string, taskId: string, attempt: number): Promise<AgentSession> {
    const project = await this.projectService.getProject(projectId);
    const sessionPath = path.join(project.repoPath, OPENSPRINT_PATHS.sessions, `${taskId}-${attempt}.json`);
    const data = await fs.readFile(sessionPath, "utf-8");
    return JSON.parse(data) as AgentSession;
  }
}
