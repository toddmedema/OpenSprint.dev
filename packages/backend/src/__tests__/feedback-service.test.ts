import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { FeedbackService } from "../services/feedback.service.js";
import { ProjectService } from "../services/project.service.js";
import type { FeedbackItem } from "@opensprint/shared";
import { DEFAULT_HIL_CONFIG, OPENSPRINT_PATHS } from "@opensprint/shared";

const mockInvoke = vi.fn();
vi.mock("../services/agent-client.js", () => ({
  AgentClient: vi.fn().mockImplementation(() => ({
    invoke: (opts: { prompt?: string }) => mockInvoke(opts),
  })),
}));

vi.mock("../services/hil-service.js", () => ({
  hilService: { evaluateDecision: vi.fn().mockResolvedValue({ approved: false }) },
}));

vi.mock("../websocket/index.js", () => ({
  broadcastToProject: vi.fn(),
}));

describe("FeedbackService", () => {
  let feedbackService: FeedbackService;
  let projectService: ProjectService;
  let tempDir: string;
  let projectId: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    feedbackService = new FeedbackService();
    projectService = new ProjectService();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opensprint-feedback-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    const project = await projectService.createProject({
      name: "Test Project",
      description: "A test project",
      repoPath: path.join(tempDir, "my-project"),
      planningAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
      codingAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
      deployment: { mode: "custom" },
      hilConfig: DEFAULT_HIL_CONFIG,
    });
    projectId = project.id;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should list feedback items with createdTaskIds for Build tab navigation", async () => {
    const repoPath = path.join(tempDir, "my-project");
    const feedbackDir = path.join(repoPath, OPENSPRINT_PATHS.feedback);
    await fs.mkdir(feedbackDir, { recursive: true });

    const feedbackItem = {
      id: "fb-1",
      text: "Login button doesn't work",
      category: "bug",
      mappedPlanId: "auth-plan",
      createdTaskIds: ["bd-a3f8.5", "bd-a3f8.6"],
      status: "mapped",
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(feedbackDir, "fb-1.json"),
      JSON.stringify(feedbackItem),
      "utf-8",
    );

    const items = await feedbackService.listFeedback(projectId);

    expect(items).toHaveLength(1);
    expect(items[0].createdTaskIds).toEqual(["bd-a3f8.5", "bd-a3f8.6"]);
    expect(items[0].mappedPlanId).toBe("auth-plan");
    expect(items[0].id).toBe("fb-1");
  });

  it("should return empty createdTaskIds for pending feedback", async () => {
    const repoPath = path.join(tempDir, "my-project");
    const feedbackDir = path.join(repoPath, OPENSPRINT_PATHS.feedback);
    await fs.mkdir(feedbackDir, { recursive: true });

    const feedbackItem = {
      id: "fb-2",
      text: "Add dark mode",
      category: "feature",
      mappedPlanId: null,
      createdTaskIds: [],
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(feedbackDir, "fb-2.json"),
      JSON.stringify(feedbackItem),
      "utf-8",
    );

    const items = await feedbackService.listFeedback(projectId);

    expect(items).toHaveLength(1);
    expect(items[0].createdTaskIds).toEqual([]);
    expect(items[0].status).toBe("pending");
  });

  it("should categorize feedback via planning agent with PRD and plans context", async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({
        category: "feature",
        mappedPlanId: "auth-plan",
        task_titles: ["Add dark mode toggle", "Implement theme persistence"],
      }),
    });

    const item = await feedbackService.submitFeedback(projectId, {
      text: "Users want dark mode",
    });

    expect(item.status).toBe("pending");
    expect(item.id).toBeDefined();

    // Wait for async categorization
    await new Promise((r) => setTimeout(r, 50));

    const updated = await feedbackService.getFeedback(projectId, item.id);
    expect(updated.status).toBe("mapped");
    expect(updated.category).toBe("feature");
    expect(updated.mappedPlanId).toBe("auth-plan");
    expect((updated as FeedbackItem & { taskTitles?: string[] }).taskTitles).toEqual([
      "Add dark mode toggle",
      "Implement theme persistence",
    ]);
    expect(updated.createdTaskIds).toEqual([]);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const prompt = mockInvoke.mock.calls[0][0]?.prompt ?? "";
    expect(prompt).toContain("# PRD");
    expect(prompt).toContain("# Plans");
    expect(prompt).toContain("Users want dark mode");
  });

  it("should support legacy suggestedTitle when task_titles is missing", async () => {
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({
        category: "bug",
        mappedPlanId: null,
        suggestedTitle: "Fix login button",
      }),
    });

    const item = await feedbackService.submitFeedback(projectId, {
      text: "Login button broken",
    });

    await new Promise((r) => setTimeout(r, 50));

    const updated = await feedbackService.getFeedback(projectId, item.id);
    expect(updated.category).toBe("bug");
    expect((updated as FeedbackItem & { taskTitles?: string[] }).taskTitles).toEqual(["Fix login button"]);
  });

  it("should fallback to bug and first plan when agent returns invalid JSON", async () => {
    mockInvoke.mockResolvedValue({ content: "This is not valid JSON at all" });

    const item = await feedbackService.submitFeedback(projectId, {
      text: "Something broke",
    });

    await new Promise((r) => setTimeout(r, 50));

    const updated = await feedbackService.getFeedback(projectId, item.id);
    expect(updated.status).toBe("mapped");
    expect(updated.category).toBe("bug");
    expect((updated as FeedbackItem & { taskTitles?: string[] }).taskTitles).toEqual(["Something broke"]);
  });

  it("should fallback to bug when agent throws", async () => {
    mockInvoke.mockRejectedValue(new Error("Agent timeout"));

    const item = await feedbackService.submitFeedback(projectId, {
      text: "Random feedback",
    });

    await new Promise((r) => setTimeout(r, 50));

    const updated = await feedbackService.getFeedback(projectId, item.id);
    expect(updated.status).toBe("mapped");
    expect(updated.category).toBe("bug");
    expect((updated as FeedbackItem & { taskTitles?: string[] }).taskTitles).toEqual(["Random feedback"]);
  });
});
