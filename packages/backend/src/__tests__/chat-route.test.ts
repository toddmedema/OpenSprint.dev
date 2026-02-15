import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createApp } from "../app.js";
import { ProjectService } from "../services/project.service.js";
import { API_PREFIX, DEFAULT_HIL_CONFIG, OPENSPRINT_PATHS } from "@opensprint/shared";

vi.mock("../services/agent.service.js", () => ({
  agentService: {
    invokePlanningAgent: vi.fn().mockResolvedValue({
      content: "I'd be happy to help you design your product. What are your main goals?",
    }),
  },
}));

describe("Chat REST API", () => {
  let app: ReturnType<typeof createApp>;
  let projectService: ProjectService;
  let tempDir: string;
  let projectId: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    app = createApp();
    projectService = new ProjectService();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opensprint-chat-route-test-"));
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

  it("GET /projects/:id/chat/history should return empty conversation when none exists", async () => {
    const res = await request(app).get(
      `${API_PREFIX}/projects/${projectId}/chat/history`
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.context).toBe("design");
    expect(res.body.data.messages).toEqual([]);
  });

  it("GET /projects/:id/chat/history should accept context query param", async () => {
    const res = await request(app).get(
      `${API_PREFIX}/projects/${projectId}/chat/history?context=plan:auth-plan`
    );

    expect(res.status).toBe(200);
    expect(res.body.data.context).toBe("plan:auth-plan");
    expect(res.body.data.messages).toEqual([]);
  });

  it("POST /projects/:id/chat should send message and return agent response", async () => {
    const res = await request(app)
      .post(`${API_PREFIX}/projects/${projectId}/chat`)
      .send({ message: "I want to build a todo app" });

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.message).toBeDefined();
    expect(typeof res.body.data.message).toBe("string");
  });

  it("POST /projects/:id/chat should persist conversation; GET history returns it", async () => {
    const postRes = await request(app)
      .post(`${API_PREFIX}/projects/${projectId}/chat`)
      .send({ message: "Hello, help me design my product" });

    expect(postRes.status).toBe(200);

    const getRes = await request(app).get(
      `${API_PREFIX}/projects/${projectId}/chat/history`
    );

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.messages).toHaveLength(2); // user + assistant
    expect(getRes.body.data.messages[0].role).toBe("user");
    expect(getRes.body.data.messages[0].content).toBe("Hello, help me design my product");
    expect(getRes.body.data.messages[1].role).toBe("assistant");
    expect(getRes.body.data.messages[1].content).toBeDefined();
  });

  it("POST /projects/:id/chat should return 400 when message is empty", async () => {
    const res = await request(app)
      .post(`${API_PREFIX}/projects/${projectId}/chat`)
      .send({ message: "" });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("INVALID_INPUT");
  });

  it("POST /projects/:id/chat should return 400 when message is missing", async () => {
    const res = await request(app)
      .post(`${API_PREFIX}/projects/${projectId}/chat`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("INVALID_INPUT");
  });

  it("conversation should be stored in .opensprint/conversations/", async () => {
    await request(app)
      .post(`${API_PREFIX}/projects/${projectId}/chat`)
      .send({ message: "Test message" });

    const convDir = path.join(tempDir, "my-project", OPENSPRINT_PATHS.conversations);
    const files = await fs.readdir(convDir);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith(".json"))).toBe(true);

    const jsonFile = files.find((f) => f.endsWith(".json"));
    const content = await fs.readFile(path.join(convDir, jsonFile!), "utf-8");
    const conv = JSON.parse(content);
    expect(conv.id).toBeDefined();
    expect(conv.context).toBe("design");
    expect(conv.messages).toHaveLength(2);
  });
});
