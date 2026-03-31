import type {
  HelpChatRequest,
  HelpChatResponse,
  HelpChatHistory,
  ActiveAgent,
  AgentConfig,
} from "@opensprint/shared";
import {
  getAgentForPlanningRole,
  AGENT_ROLE_LABELS,
  OPENSPRINT_PATHS,
  getDatabaseDialect,
} from "@opensprint/shared";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { ProjectService } from "./project.service.js";
import { PrdService } from "./prd.service.js";
import { PlanService } from "./plan.service.js";
import { taskStore } from "./task-store.service.js";
import type { StoredTask } from "./task-store.service.js";
import { orchestratorService } from "./orchestrator.service.js";
import { agentService } from "./agent.service.js";
import { getDatabaseUrl } from "./global-settings.service.js";
import { AppError } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { createLogger } from "../utils/logger.js";
import { assertMigrationCompleteForResource } from "./migration-guard.service.js";
import { getCombinedInstructions } from "./agent-instructions.service.js";

const log = createLogger("help-chat");

const HELP_SYSTEM_PROMPT = `You are the Help assistant for Open Sprint, an AI-powered software development workflow tool.

**CRITICAL: Ask-only mode.** You must ONLY answer questions. You must NEVER:
- Change project state, PRD, plans, or tasks
- Output [PRD_UPDATE], [PLAN_UPDATE], or any structured update blocks
- Create, modify, or close tasks
- Suggest or perform any state-changing operations

Your role is to help users understand their projects, tasks, plans, and currently running agents. Answer based on the context provided. If the user asks for something you cannot do (e.g. "create a task"), politely explain that you are in ask-only mode and direct them to the appropriate part of the UI.

**How to help:**
- Explain what you see in the context (PRD, plans, tasks, active agents)
- When asked "how many agents are running" or similar, report the exact count and list each agent from the "Currently Running Agents" section — never say "(None)" if the context shows agents
- Answer questions about Open Sprint workflow (Sketch, Plan, Execute, Evaluate, Deliver)
- Point users to where they can take action (e.g. "Use the Execute tab to run tasks")
- Describe agent roles and phases when asked
- Use the "Open Sprint Internal Documentation" section to explain internal behavior (scheduling, task runnability, why one coder is active, epic-blocked logic, loop kicker vs watchdog). Never say "I don't have access" — you have the docs.`;

const HELP_TOOLING_PROMPT = `
## Help Tools (read-only)

You have read-only tools for task store and database lookups. Do NOT guess task details. When you need fresh data, call a tool.

To call a tool, respond with ONLY this block:
[HELP_TOOL_CALL]
{"tool":"<tool_name>","args":{...}}
[/HELP_TOOL_CALL]

Supported tools:
- list_projects: {}
- get_database_info: {}
- list_tasks: {"limit"?: number, "offset"?: number, "status"?: string, "assignee"?: string, "issueType"?: string, "query"?: string, "includeEpics"?: boolean}
- get_task: {"taskId": string}
- task_counts: {}
- ready_tasks: {"limit"?: number}

After a tool call, you'll receive:
[HELP_TOOL_RESULT]
{ ...json result ... }
[/HELP_TOOL_RESULT]

Then continue reasoning. When you have enough info, answer normally (without tool-call tags).
`;

/** Max chars per section in context to avoid token overflow */
const MAX_CONTEXT_CHARS = 8000;

/** Max chars for Open Sprint internal docs section */
const MAX_DOCS_CHARS = 12000;

/** Path to bundled Open Sprint internal docs (relative to backend package) */
const OPENSPRINT_HELP_DOCS_PATH = "docs/opensprint-help-context.md";
const MAX_TOOL_ROUNDS = 8;
const HELP_TOOL_CALL_OPEN = "[HELP_TOOL_CALL]";
const HELP_TOOL_CALL_CLOSE = "[/HELP_TOOL_CALL]";

/** Load Open Sprint internal docs for Help Chat context. Returns empty string if file not found. */
async function loadOpenSprintDocs(): Promise<string> {
  try {
    const servicesDir = path.dirname(fileURLToPath(import.meta.url));
    const docsPath = path.resolve(servicesDir, "..", "..", OPENSPRINT_HELP_DOCS_PATH);
    const content = await fs.readFile(docsPath, "utf-8");
    return truncate(content, MAX_DOCS_CHARS);
  } catch {
    return "";
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n\n[... truncated for context length]";
}

function summarizeTask(task: StoredTask): string {
  const blockers = taskStore.getBlockersFromIssue(task);
  return JSON.stringify(
    {
      id: task.id,
      title: task.title,
      status: task.status,
      issueType: task.issue_type,
      assignee: task.assignee ?? null,
      priority: task.priority ?? null,
      blockers,
      dependentCount: task.dependentCount ?? 0,
      description: task.description ?? null,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      labels: task.labels ?? [],
    },
    null,
    2
  );
}

async function buildDatabaseContext(): Promise<string> {
  try {
    const databaseUrl = await getDatabaseUrl();
    const dialect = getDatabaseDialect(databaseUrl);
    let target = "(unavailable)";
    try {
      const parsed = new URL(databaseUrl);
      if (dialect === "sqlite") {
        target = parsed.pathname || "(default sqlite path)";
      } else {
        target = `${parsed.hostname}${parsed.pathname}`;
      }
    } catch {
      // Keep fallback target
    }
    return `## Open Sprint Database\n\n- backend: ${dialect}\n- target: ${target}\n- source: DATABASE_URL, then ~/.opensprint/global-settings.json databaseUrl, then default SQLite path`;
  } catch {
    return "";
  }
}

function parseHelpToolCall(
  content: string
): { tool: string; args: Record<string, unknown> } | null {
  const start = content.indexOf(HELP_TOOL_CALL_OPEN);
  const end = content.indexOf(HELP_TOOL_CALL_CLOSE);
  if (start === -1 || end === -1 || end <= start) return null;
  const json = content.slice(start + HELP_TOOL_CALL_OPEN.length, end).trim();
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { tool?: unknown; args?: unknown };
    if (typeof parsed.tool !== "string" || !parsed.tool.trim()) return null;
    return {
      tool: parsed.tool.trim(),
      args:
        parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
          ? (parsed.args as Record<string, unknown>)
          : {},
    };
  } catch {
    return null;
  }
}

const HELP_CHAT_FILENAME = "help.json";
const HELP_CHAT_HOMEPAGE_SCOPE = "homepage";

export class HelpChatService {
  private projectService = new ProjectService();
  private prdService = new PrdService();
  private planService: PlanService | null = null;

  private getPlanService(): PlanService {
    this.planService ??= new PlanService();
    return this.planService;
  }

  private getScopeKey(projectId: string | null): string {
    return projectId ? `project:${projectId}` : HELP_CHAT_HOMEPAGE_SCOPE;
  }

  /** Clear project list cache (for tests that overwrite projects.json). */
  clearProjectListCacheForTesting(): void {
    this.projectService.clearListCacheForTesting();
  }

  /** Path for per-project help chat (in .opensprint/conversations/) */
  private async getProjectHelpChatPath(projectId: string): Promise<string> {
    const project = await this.projectService.getProject(projectId);
    return path.join(project.repoPath, OPENSPRINT_PATHS.conversations, HELP_CHAT_FILENAME);
  }

  /** Load help chat history (per-project or homepage) */
  async getHistory(projectId: string | null): Promise<HelpChatHistory> {
    const scopeKey = this.getScopeKey(projectId);
    const client = await taskStore.getDb();
    const row = await client.queryOne(
      "SELECT messages FROM help_chat_histories WHERE scope_key = $1",
      [scopeKey]
    );

    if (!row) {
      if (projectId) {
        const legacyPath = await this.getProjectHelpChatPath(projectId);
        await assertMigrationCompleteForResource({
          hasDbRecord: false,
          resource: "Help chat history",
          legacyPaths: [legacyPath],
          projectId,
        });
      }
      return { messages: [] };
    }

    try {
      const parsed = JSON.parse(String(row.messages ?? "[]")) as unknown;
      if (Array.isArray(parsed)) {
        return { messages: parsed as HelpChatHistory["messages"] };
      }
    } catch {
      // invalid JSON in row -> treat as empty
    }

    return { messages: [] };
  }

  /** Save help chat history */
  private async saveHistory(projectId: string | null, history: HelpChatHistory): Promise<void> {
    const scopeKey = this.getScopeKey(projectId);
    const existing = await taskStore
      .getDb()
      .then((client) =>
        client.queryOne("SELECT 1 FROM help_chat_histories WHERE scope_key = $1", [scopeKey])
      );

    if (!existing && projectId) {
      const legacyPath = await this.getProjectHelpChatPath(projectId);
      await assertMigrationCompleteForResource({
        hasDbRecord: false,
        resource: "Help chat history",
        legacyPaths: [legacyPath],
        projectId,
      });
    }

    const now = new Date().toISOString();
    await taskStore.runWrite(async (client) => {
      await client.execute(
        `INSERT INTO help_chat_histories (scope_key, messages, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(scope_key) DO UPDATE SET
           messages = excluded.messages,
           updated_at = excluded.updated_at`,
        [scopeKey, JSON.stringify(history.messages ?? []), now]
      );
    });
  }

  /** Build project-scoped context: PRD, plans, active agents (no task snapshots). */
  private async buildProjectContext(projectId: string): Promise<string> {
    const [project, prdResult, plansResult, agents] = await Promise.all([
      this.projectService.getProject(projectId),
      this.prdService.getPrd(projectId).catch(() => null),
      this.getPlanService()
        .listPlans(projectId)
        .catch(() => []),
      orchestratorService.getActiveAgents(projectId).catch(() => []),
    ]);

    const parts: string[] = [];
    parts.push(`## Project: ${project.name} (${projectId})`);

    // PRD
    if (prdResult?.sections) {
      let prdText = "";
      for (const [key, section] of Object.entries(prdResult.sections)) {
        if (section?.content) {
          const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          prdText += `### ${label}\n${section.content}\n\n`;
        }
      }
      if (prdText) {
        parts.push("## PRD\n\n" + truncate(prdText, MAX_CONTEXT_CHARS));
      } else {
        parts.push("## PRD\n(Empty or not yet created)");
      }
    } else {
      parts.push("## PRD\n(Not found)");
    }

    // Plans
    if (plansResult.length > 0) {
      const planLines = plansResult.map(
        (p) =>
          `- ${p.metadata.planId}: ${p.metadata.epicId} | status: ${p.status} | tasks: ${p.doneTaskCount}/${p.taskCount}`
      );
      parts.push("## Plans\n\n" + planLines.join("\n"));
    } else {
      parts.push("## Plans\n(No plans yet)");
    }

    parts.push(
      "## Task Access\n\nTask details are intentionally not preloaded. Use the help tools to query task store data on demand."
    );

    // Active agents
    if (agents.length > 0) {
      const agentLines = agents.map(
        (a) =>
          `- ${AGENT_ROLE_LABELS[a.role as keyof typeof AGENT_ROLE_LABELS] ?? a.role}: ${a.label} (phase: ${a.phase})`
      );
      parts.push("## Currently Running Agents\n\n" + agentLines.join("\n"));
    } else {
      parts.push("## Currently Running Agents\n(None)");
    }

    const dbContext = await buildDatabaseContext();
    if (dbContext) {
      parts.push(dbContext);
    }

    return parts.join("\n\n---\n\n");
  }

  /** Build homepage context: projects summary, active agents across all projects */
  private async buildHomepageContext(): Promise<string> {
    const projects = await this.projectService.listProjects();
    const agentsWithProject: { agent: ActiveAgent; projectName: string }[] = [];
    for (const p of projects) {
      try {
        const agents = await orchestratorService.getActiveAgents(p.id);
        for (const a of agents) {
          agentsWithProject.push({ agent: a, projectName: p.name });
        }
      } catch {
        // Skip projects that fail (e.g. not yet initialized)
      }
    }

    const parts: string[] = [];
    parts.push("## Homepage View — All Projects");

    if (projects.length > 0) {
      const projectLines = projects.map((p) => `- ${p.name} (id: ${p.id})`);
      parts.push("## Projects\n\n" + projectLines.join("\n"));
    } else {
      parts.push("## Projects\n(No projects yet)");
    }

    if (agentsWithProject.length > 0) {
      const agentLines = agentsWithProject.map(
        ({ agent: a, projectName }) =>
          `- ${AGENT_ROLE_LABELS[a.role as keyof typeof AGENT_ROLE_LABELS] ?? a.role}: ${a.label} | project: ${projectName} | phase: ${a.phase}`
      );
      parts.push("## Currently Running Agents (across all projects)\n\n" + agentLines.join("\n"));
    } else {
      parts.push("## Currently Running Agents\n(None)");
    }

    parts.push(
      "\n**Instructions for the user:** To get detailed task context for a project, open that project and use the Help modal from the project view."
    );

    return parts.join("\n\n---\n\n");
  }

  private async runHelpTool(
    projectId: string | null,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const dbContext = await buildDatabaseContext();
    const clamp = (value: unknown, fallback = 50, max = 500): number => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(0, Math.min(max, Math.floor(n)));
    };

    if (toolName === "list_projects") {
      const projects = await this.projectService.listProjects();
      return JSON.stringify(
        {
          projects: projects.map((p) => ({ id: p.id, name: p.name, repoPath: p.repoPath })),
        },
        null,
        2
      );
    }

    if (toolName === "get_database_info") {
      const connection = await taskStore.checkConnection();
      return JSON.stringify({ connection, context: dbContext }, null, 2);
    }

    if (!projectId) {
      return JSON.stringify(
        {
          error:
            "Project-scoped tool requires projectId context. Ask the user to open a project and try again.",
        },
        null,
        2
      );
    }

    if (toolName === "get_task") {
      const taskId = String(args.taskId ?? "").trim();
      if (!taskId) return JSON.stringify({ error: "Missing required arg: taskId" }, null, 2);
      try {
        const task = await taskStore.show(projectId, taskId);
        return summarizeTask(task);
      } catch {
        return JSON.stringify({ taskId, error: "Task not found" }, null, 2);
      }
    }

    if (toolName === "task_counts") {
      const all = await taskStore.listAll(projectId);
      const byStatus = new Map<string, number>();
      const byType = new Map<string, number>();
      for (const task of all) {
        byStatus.set(task.status, (byStatus.get(task.status) ?? 0) + 1);
        byType.set(task.issue_type, (byType.get(task.issue_type) ?? 0) + 1);
      }
      return JSON.stringify(
        {
          projectId,
          total: all.length,
          byStatus: Object.fromEntries(
            [...byStatus.entries()].sort(([a], [b]) => a.localeCompare(b))
          ),
          byType: Object.fromEntries([...byType.entries()].sort(([a], [b]) => a.localeCompare(b))),
        },
        null,
        2
      );
    }

    if (toolName === "ready_tasks") {
      const ready = await taskStore.ready(projectId);
      const limit = clamp(args.limit, 50, 500);
      return JSON.stringify(
        {
          projectId,
          totalReady: ready.length,
          tasks: ready.slice(0, limit).map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            assignee: task.assignee ?? null,
            priority: task.priority ?? null,
          })),
        },
        null,
        2
      );
    }

    if (toolName === "list_tasks") {
      const all = await taskStore.listAll(projectId);
      const includeEpics = args.includeEpics === true;
      const status = typeof args.status === "string" ? args.status.trim().toLowerCase() : "";
      const assignee = typeof args.assignee === "string" ? args.assignee.trim().toLowerCase() : "";
      const issueType =
        typeof args.issueType === "string" ? args.issueType.trim().toLowerCase() : "";
      const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      const offset = clamp(args.offset, 0, 50_000);
      const limit = clamp(args.limit, 50, 500);
      const filtered = all.filter((task) => {
        if (!includeEpics && task.issue_type === "epic") return false;
        if (status && task.status.toLowerCase() !== status) return false;
        if (assignee && (task.assignee ?? "").toLowerCase() !== assignee) return false;
        if (issueType && task.issue_type.toLowerCase() !== issueType) return false;
        if (query) {
          const haystack = `${task.id} ${task.title ?? ""} ${task.description ?? ""}`.toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      });
      const rows = filtered.slice(offset, offset + limit).map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        issueType: task.issue_type,
        assignee: task.assignee ?? null,
        priority: task.priority ?? null,
      }));
      return JSON.stringify(
        {
          projectId,
          totalMatching: filtered.length,
          offset,
          limit,
          tasks: rows,
        },
        null,
        2
      );
    }

    return JSON.stringify({ error: `Unknown tool: ${toolName}` }, null, 2);
  }

  private async invokeHelpAgentWithTools(params: {
    projectId: string | null;
    effectiveProjectId: string;
    agentConfig: AgentConfig;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    systemPrompt: string;
    cwd?: string;
    agentId: string;
  }): Promise<string> {
    const { projectId, effectiveProjectId, agentConfig, messages, systemPrompt, cwd, agentId } =
      params;
    const loopMessages = [...messages];
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await agentService.invokePlanningAgent({
        projectId: effectiveProjectId,
        role: "dreamer",
        config: agentConfig,
        messages: loopMessages,
        systemPrompt,
        cwd,
        tracking: {
          id: round === 0 ? agentId : `${agentId}-tool-${round}`,
          projectId: effectiveProjectId,
          phase: "help",
          role: "dreamer",
          label: "Help chat",
        },
      });
      const content = response?.content ?? "";
      const call = parseHelpToolCall(content);
      if (!call) return content;

      const toolResult = await this.runHelpTool(projectId, call.tool, call.args);
      loopMessages.push({ role: "assistant", content });
      loopMessages.push({
        role: "user",
        content: `[HELP_TOOL_RESULT]\n${toolResult}\n[/HELP_TOOL_RESULT]\nContinue and answer the user's original question. Call another tool if needed.`,
      });
    }
    return "I couldn't complete the lookup within tool limits. Please narrow the question (for example, ask for a specific task ID or status).";
  }

  async sendMessage(body: HelpChatRequest): Promise<HelpChatResponse> {
    const message = body.message?.trim();
    if (!message) {
      throw new AppError(400, ErrorCodes.INVALID_INPUT, "Message is required");
    }

    const projectId = body.projectId?.trim() || null;
    const isProjectView = !!projectId;

    if (isProjectView) {
      await this.projectService.getProject(projectId!);
    }

    const [context, opensprintDocs] = await Promise.all([
      isProjectView && projectId
        ? this.buildProjectContext(projectId)
        : this.buildHomepageContext(),
      loadOpenSprintDocs(),
    ]);

    const docsSection =
      opensprintDocs.length > 0
        ? `\n\n---\n\n## Open Sprint Internal Documentation\n\nThe following describes Open Sprint's internal behavior. Use it to answer questions about scheduling, config, orchestrator logic, task runnability, epic-blocked behavior, and why agents run (or don't run).\n\n${opensprintDocs}`
        : "";

    let systemPrompt = `${HELP_SYSTEM_PROMPT}\n\n${HELP_TOOLING_PROMPT}\n\n---\n\n## Current Context\n\nThe following context is provided for answering the user's question. Use it to give accurate, helpful answers.\n\n${context}${docsSection}`;

    const priorMessages = (body.messages ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    const messages = [...priorMessages, { role: "user" as const, content: message }];

    // Agent config: use project settings when in project view; otherwise first project
    let agentConfig;
    let cwd: string | undefined;
    if (isProjectView && projectId) {
      const [settings, project] = await Promise.all([
        this.projectService.getSettings(projectId),
        this.projectService.getProject(projectId),
      ]);
      agentConfig = getAgentForPlanningRole(settings, "dreamer");
      cwd = project.repoPath;
    } else {
      const projects = await this.projectService.listProjects();
      if (projects.length === 0) {
        throw new AppError(
          400,
          ErrorCodes.INVALID_INPUT,
          "No projects exist. Create a project to use the Help chat."
        );
      }
      const firstProject = projects[0]!;
      const settings = await this.projectService.getSettings(firstProject.id);
      agentConfig = getAgentForPlanningRole(settings, "dreamer");
      cwd = firstProject.repoPath;
    }

    systemPrompt += `\n\n${await getCombinedInstructions(cwd!, "dreamer")}`;

    const agentId = `help-chat-${isProjectView ? projectId : "homepage"}-${Date.now()}`;

    try {
      log.info("Invoking help agent", {
        projectId: projectId ?? "homepage",
        messageLen: message.length,
      });
      const effectiveProjectId = projectId ?? "help-homepage";
      const content = await this.invokeHelpAgentWithTools({
        projectId,
        effectiveProjectId,
        agentConfig,
        messages,
        systemPrompt,
        cwd,
        agentId,
      });
      log.info("Help agent returned", { contentLen: content.length });

      // Persist conversation for page reload / session continuity
      const history: HelpChatHistory = {
        messages: [
          ...priorMessages,
          { role: "user", content: message },
          { role: "assistant", content },
        ],
      };
      await this.saveHistory(projectId, history);

      return { message: content };
    } catch (error) {
      const msg = getErrorMessage(error);
      log.error("Help agent invocation failed", { error });
      const errorContent =
        "I was unable to connect to the AI assistant.\n\n" +
        `**Error:** ${msg}\n\n` +
        "**What to try:** Open Project Settings → Agent Config. Ensure your API key is set and the model is valid.";
      // Persist user message + error so history survives reload
      const history: HelpChatHistory = {
        messages: [
          ...priorMessages,
          { role: "user", content: message },
          { role: "assistant", content: errorContent },
        ],
      };
      await this.saveHistory(projectId, history).catch((e) =>
        log.warn("Failed to persist help chat on error", { err: e })
      );
      return { message: errorContent };
    }
  }
}
