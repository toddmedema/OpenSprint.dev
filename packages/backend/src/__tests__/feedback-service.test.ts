import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { FeedbackService } from "../services/feedback.service.js";
import { ProjectService } from "../services/project.service.js";
import { DEFAULT_HIL_CONFIG } from "@opensprint/shared";
import { OPENSPRINT_PATHS } from "@opensprint/shared";

describe("FeedbackService", () => {
  let feedbackService: FeedbackService;
  let projectService: ProjectService;
  let tempDir: string;
  let projectId: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
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
});
