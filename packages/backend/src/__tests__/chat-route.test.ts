import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createApp } from "../app.js";
import { ProjectService } from "../services/project.service.js";
import { API_PREFIX } from "@opensprint/shared";
import { DEFAULT_HIL_CONFIG } from "@opensprint/shared";

const mockInvoke = vi.fn();

vi.mock("../services/agent-client.js", () => ({
  AgentClient: vi.fn().mockImplementation(() => ({
    invoke: (...args: unknown[]) => mockInvoke(...args),
  })),
}));

vi.mock("../websocket/index.js", () => ({
  broadcastToProject: vi.fn(),
}));

describe("Chat REST endpoints - PRD update from agent response", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let projectId: string;
  let projectService: ProjectService;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opensprint-chat-route-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    projectService = new ProjectService();
    const repoPath = path.join(tempDir, "test-project");
    const project = await projectService.createProject({
      name: "Chat Test Project",
      description: "For chat PRD update tests",
      repoPath,
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

  it("POST /chat should parse PRD_UPDATE blocks from agent response and apply to PRD", async () => {
    const agentResponseWithPrdUpdate = `Here's my suggested executive summary for your product.

[PRD_UPDATE:executive_summary]
## Executive Summary

OpenSprint is a web application that guides users through the full software development lifecycle using AI agents.
[/PRD_UPDATE]

Let me know if you'd like to refine this further.`;

    mockInvoke.mockResolvedValue({ content: agentResponseWithPrdUpdate });

    const app = createApp();
    const res = await request(app)
      .post(`${API_PREFIX}/projects/${projectId}/chat`)
      .send({ message: "Help me write an executive summary", context: "design" });

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.message).toBeDefined();
    // Display content should have PRD_UPDATE blocks stripped
    expect(res.body.data.message).not.toContain("[PRD_UPDATE:");
    expect(res.body.data.message).not.toContain("[/PRD_UPDATE]");
    expect(res.body.data.message).toContain("Here's my suggested executive summary");

    // Response should include prdChanges (initial sections have version 0)
    expect(res.body.data.prdChanges).toBeDefined();
    expect(res.body.data.prdChanges).toHaveLength(1);
    expect(res.body.data.prdChanges[0].section).toBe("executive_summary");
    expect(res.body.data.prdChanges[0].previousVersion).toBe(0);
    expect(res.body.data.prdChanges[0].newVersion).toBe(1);

    // Verify PRD was actually updated
    const prdRes = await request(app).get(
      `${API_PREFIX}/projects/${projectId}/prd/executive_summary`
    );
    expect(prdRes.status).toBe(200);
    expect(prdRes.body.data.content).toContain(
      "OpenSprint is a web application that guides users through the full software development lifecycle using AI agents"
    );
    expect(prdRes.body.data.version).toBe(1);
  });

  it("POST /chat should handle multiple PRD_UPDATE blocks in one response", async () => {
    const agentResponse = `I've updated two sections for you.

[PRD_UPDATE:executive_summary]
## Executive Summary

Product A helps users do X.
[/PRD_UPDATE]

[PRD_UPDATE:problem_statement]
## Problem Statement

Users currently face Y.
[/PRD_UPDATE]

Hope that helps!`;

    mockInvoke.mockResolvedValue({ content: agentResponse });

    const app = createApp();
    const res = await request(app)
      .post(`${API_PREFIX}/projects/${projectId}/chat`)
      .send({ message: "Update both sections", context: "design" });

    expect(res.status).toBe(200);
    expect(res.body.data.prdChanges).toHaveLength(2);
    const sections = res.body.data.prdChanges.map((c: { section: string }) => c.section);
    expect(sections).toContain("executive_summary");
    expect(sections).toContain("problem_statement");

    const execRes = await request(app).get(
      `${API_PREFIX}/projects/${projectId}/prd/executive_summary`
    );
    expect(execRes.body.data.content).toContain("Product A helps users do X");

    const problemRes = await request(app).get(
      `${API_PREFIX}/projects/${projectId}/prd/problem_statement`
    );
    expect(problemRes.body.data.content).toContain("Users currently face Y");
  });

  it("POST /chat should return message without prdChanges when agent response has no PRD_UPDATE blocks", async () => {
    mockInvoke.mockResolvedValue({
      content: "That's a great question! Could you tell me more about your target users?",
    });

    const app = createApp();
    const res = await request(app)
      .post(`${API_PREFIX}/projects/${projectId}/chat`)
      .send({ message: "What should I include?", context: "design" });

    expect(res.status).toBe(200);
    expect(res.body.data.prdChanges).toBeUndefined();
    expect(res.body.data.message).toContain("That's a great question!");
  });
});
