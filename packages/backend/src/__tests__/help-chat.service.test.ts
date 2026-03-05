import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { DEFAULT_HIL_CONFIG } from "@opensprint/shared";
import { HelpChatService } from "../services/help-chat.service.js";

const mockGetProject = vi.fn();
const mockListProjects = vi.fn();
const mockGetSettings = vi.fn();
const mockGetPrd = vi.fn();
const mockListPlans = vi.fn();
const mockTaskListAll = vi.fn();
const mockGetActiveAgents = vi.fn();
const mockInvokePlanningAgent = vi.fn();
const helpHistoryByScope = new Map<string, string>();

vi.mock("../services/project.service.js", () => ({
  ProjectService: class {
    getProject = (...args: unknown[]) => mockGetProject(...args);
    listProjects = (...args: unknown[]) => mockListProjects(...args);
    getSettings = (...args: unknown[]) => mockGetSettings(...args);
    clearListCacheForTesting = vi.fn();
  },
}));

vi.mock("../services/prd.service.js", () => ({
  PrdService: class {
    getPrd = (...args: unknown[]) => mockGetPrd(...args);
  },
}));

vi.mock("../services/plan.service.js", () => ({
  PlanService: class {
    listPlans = (...args: unknown[]) => mockListPlans(...args);
  },
}));

vi.mock("../services/task-store.service.js", () => ({
  taskStore: {
    listAll: (...args: unknown[]) => mockTaskListAll(...args),
    getDb: async () => ({
      queryOne: async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM help_chat_histories")) {
          const scopeKey = String(params?.[0] ?? "");
          const messages = helpHistoryByScope.get(scopeKey);
          return messages ? { messages } : undefined;
        }
        return undefined;
      },
    }),
    runWrite: async (
      fn: (client: {
        execute: (sql: string, params?: unknown[]) => Promise<number>;
      }) => Promise<void>
    ) => {
      await fn({
        execute: async (sql: string, params?: unknown[]) => {
          if (sql.includes("INSERT INTO help_chat_histories")) {
            const scopeKey = String(params?.[0] ?? "");
            const messages = String(params?.[1] ?? "[]");
            helpHistoryByScope.set(scopeKey, messages);
            return 1;
          }
          return 0;
        },
      });
    },
  },
}));

vi.mock("../services/orchestrator.service.js", () => ({
  orchestratorService: {
    getActiveAgents: (...args: unknown[]) => mockGetActiveAgents(...args),
  },
}));

vi.mock("../services/agent.service.js", () => ({
  agentService: {
    invokePlanningAgent: (...args: unknown[]) => mockInvokePlanningAgent(...args),
  },
}));

function makeSettings() {
  return {
    simpleComplexityAgent: { type: "cursor", model: null, cliCommand: null },
    complexComplexityAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
    deployment: { mode: "custom" },
    hilConfig: DEFAULT_HIL_CONFIG,
    testFramework: "vitest",
    gitWorkingMode: "worktree",
  };
}

describe("HelpChatService", () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    helpHistoryByScope.clear();
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "opensprint-help-chat-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
    mockGetSettings.mockResolvedValue(makeSettings());
    mockInvokePlanningAgent.mockResolvedValue({ content: "Help answer" });
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it("returns empty history when no file exists", async () => {
    const service = new HelpChatService();
    await expect(service.getHistory(null)).resolves.toEqual({ messages: [] });
  });

  it("builds project-scoped context, truncates long PRD sections, and persists history", async () => {
    const repoPath = path.join(tempHome, "repo");
    await fs.mkdir(repoPath, { recursive: true });
    mockGetProject.mockResolvedValue({ id: "proj-1", name: "Project One", repoPath });
    mockGetPrd.mockResolvedValue({
      sections: {
        executive_summary: { content: "x".repeat(8105) },
      },
    });
    mockListPlans.mockResolvedValue([
      {
        metadata: { planId: "plan-a", epicId: "epic-a" },
        status: "planning",
        doneTaskCount: 0,
        taskCount: 1,
      },
    ]);
    mockTaskListAll.mockResolvedValue([
      { id: "epic-a", issue_type: "epic", title: "Epic", status: "blocked" },
      {
        id: "epic-a.1",
        issue_type: "task",
        title: "Implement API",
        status: "open",
        assignee: null,
      },
    ]);
    mockGetActiveAgents.mockResolvedValue([{ role: "planner", label: "Gandalf", phase: "plan" }]);

    const service = new HelpChatService();
    const response = await service.sendMessage({
      projectId: "proj-1",
      message: "What is running?",
      messages: [{ role: "assistant", content: "Previous" }],
    });

    expect(response).toEqual({ message: "Help answer" });
    expect(mockInvokePlanningAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-1",
        cwd: repoPath,
        systemPrompt: expect.stringContaining("Ask-only mode"),
      })
    );
    const call = mockInvokePlanningAgent.mock.calls[0][0];
    expect(call.systemPrompt).toContain("Currently Running Agents");
    expect(call.systemPrompt).toContain("Planner: Gandalf");
    expect(call.systemPrompt).toContain("[... truncated for context length]");

    const saved = await service.getHistory("proj-1");
    expect(saved.messages).toHaveLength(3);
    expect(saved.messages[2].content).toBe("Help answer");
  });

  it("falls back cleanly when help docs are missing on homepage chat", async () => {
    const repoPath = path.join(tempHome, "repo");
    await fs.mkdir(repoPath, { recursive: true });
    mockListProjects.mockResolvedValue([{ id: "proj-1", name: "Project One", repoPath }]);
    mockGetActiveAgents.mockResolvedValue([]);

    const originalReadFile = fs.readFile.bind(fs);
    vi.spyOn(fs, "readFile").mockImplementation((file, options) => {
      if (String(file).includes("opensprint-help-context.md")) {
        return Promise.reject(new Error("missing docs"));
      }
      return originalReadFile(file as Parameters<typeof fs.readFile>[0], options as never);
    });

    const service = new HelpChatService();
    await service.sendMessage({ message: "Summarize projects" });

    const call = mockInvokePlanningAgent.mock.calls[0][0];
    expect(call.projectId).toBe("help-homepage");
    expect(call.systemPrompt).toContain("## Homepage View");
    expect(call.systemPrompt).not.toContain("## OpenSprint Internal Documentation");
  });
});
