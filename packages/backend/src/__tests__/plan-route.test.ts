import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createApp } from "../app.js";
import { ProjectService } from "../services/project.service.js";
import { BeadsService } from "../services/beads.service.js";
import { API_PREFIX } from "@opensprint/shared";
import { DEFAULT_HIL_CONFIG } from "@opensprint/shared";

// Mock orchestrator so Ship it! doesn't trigger the real loop (which would claim Task A before archive)
vi.mock("../services/orchestrator.service.js", () => ({
  orchestratorService: {
    nudge: vi.fn(),
    ensureRunning: vi.fn(),
    getStatus: vi.fn().mockResolvedValue({
      currentTask: null,
      currentPhase: null,
      queueDepth: 0,
      totalCompleted: 0,
      totalFailed: 0,
    }),
    getActiveAgents: vi.fn().mockResolvedValue([]),
  },
}));

describe("Plan REST endpoints - task decomposition", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let projectId: string;
  let projectService: ProjectService;
  let beads: BeadsService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opensprint-plan-route-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    projectService = new ProjectService();
    beads = new BeadsService();
    const repoPath = path.join(tempDir, "test-project");
    const project = await projectService.createProject({
      name: "Plan Test Project",
      description: "For plan route and task decomposition tests",
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

  it("POST /projects/:id/plans with tasks should create beads tasks via bd create", { timeout: 15000 }, async () => {
    const app = createApp();
    const planBody = {
      title: "User Authentication",
      content: "# User Authentication\n\n## Overview\n\nAuth feature.\n\n## Acceptance Criteria\n\n- Login works",
      complexity: "medium",
      tasks: [
        { title: "Implement login endpoint", description: "POST /auth/login", priority: 0, dependsOn: [] },
        {
          title: "Implement JWT validation",
          description: "Validate tokens",
          priority: 1,
          dependsOn: ["Implement login endpoint"],
        },
      ],
    };

    const res = await request(app).post(`${API_PREFIX}/projects/${projectId}/plans`).send(planBody);

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    const plan = res.body.data;
    expect(plan.taskCount).toBe(2);
    expect(plan.metadata.beadEpicId).toBeDefined();
    expect(plan.metadata.gateTaskId).toBeDefined();

    // Verify beads has the child tasks (bd create was called for each)
    const project = await projectService.getProject(projectId);
    const allIssues = await beads.listAll(project.repoPath);
    const epicId = plan.metadata.beadEpicId;
    const childTasks = allIssues.filter((i) => i.id.startsWith(epicId + ".") && i.id !== plan.metadata.gateTaskId);
    expect(childTasks.length).toBe(2);
    expect(childTasks.map((t) => t.title)).toContain("Implement login endpoint");
    expect(childTasks.map((t) => t.title)).toContain("Implement JWT validation");

    // Verify bd dep add was called: each task blocks on the gate (plan.service adds this)
    // and JWT task blocks on login task (inter-task deps)
    const readyBeforeShip = await beads.ready(project.repoPath);
    const implementationTaskIds = childTasks.map((t) => t.id);
    // Before shipping, no implementation tasks should be ready (they block on gate)
    const readyIds = readyBeforeShip.map((r) => r.id);
    for (const tid of implementationTaskIds) {
      expect(readyIds).not.toContain(tid);
    }
  });

  it("POST /projects/:id/plans without tasks should create epic and gate only", async () => {
    const app = createApp();
    const planBody = {
      title: "Standalone Feature",
      content: "# Standalone\n\nNo tasks yet.",
      complexity: "low",
    };

    const res = await request(app).post(`${API_PREFIX}/projects/${projectId}/plans`).send(planBody);

    expect(res.status).toBe(201);
    expect(res.body.data.taskCount).toBe(0);
    expect(res.body.data.metadata.beadEpicId).toBeDefined();
    expect(res.body.data.metadata.gateTaskId).toBeDefined();
  });

  it("GET /projects/:id/plans/:planId returns lastModified (plan markdown file mtime)", async () => {
    const app = createApp();
    const planBody = {
      title: "Feature With LastModified",
      content: "# Feature\n\nContent.",
      complexity: "low",
    };

    const createRes = await request(app).post(`${API_PREFIX}/projects/${projectId}/plans`).send(planBody);
    expect(createRes.status).toBe(201);
    const planId = createRes.body.data.metadata.planId;

    const getRes = await request(app).get(`${API_PREFIX}/projects/${projectId}/plans/${planId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.lastModified).toBeDefined();
    expect(typeof getRes.body.data.lastModified).toBe("string");
    // Should be valid ISO date
    expect(new Date(getRes.body.data.lastModified).getTime()).not.toBeNaN();
  });

  it("GET /projects/:id/plans list returns lastModified for each plan", async () => {
    const app = createApp();
    const planBody = {
      title: "List Test Feature",
      content: "# List Test\n\nContent.",
      complexity: "low",
    };

    await request(app).post(`${API_PREFIX}/projects/${projectId}/plans`).send(planBody);

    const listRes = await request(app).get(`${API_PREFIX}/projects/${projectId}/plans`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.plans).toBeDefined();
    expect(listRes.body.data.edges).toBeDefined();
    expect(listRes.body.data.plans.length).toBeGreaterThan(0);
    const plan = listRes.body.data.plans.find((p: { metadata: { planId: string } }) =>
      p.metadata.planId.includes("list-test-feature"),
    );
    expect(plan).toBeDefined();
    expect(plan.lastModified).toBeDefined();
    expect(typeof plan.lastModified).toBe("string");
  });

  it(
    "POST /projects/:id/plans/:planId/archive closes all ready/open tasks, leaves in_progress unchanged",
    {
      timeout: 15000,
    },
    async () => {
      const app = createApp();
      const planBody = {
        title: "Archive Test Feature",
        content: "# Archive Test\n\nContent.",
        complexity: "medium",
        tasks: [
          { title: "Task A", description: "First task", priority: 0, dependsOn: [] },
          { title: "Task B", description: "Second task", priority: 1, dependsOn: [] },
          { title: "Task C", description: "Third task", priority: 2, dependsOn: [] },
        ],
      };

      const createRes = await request(app).post(`${API_PREFIX}/projects/${projectId}/plans`).send(planBody);
      expect(createRes.status).toBe(201);
      const createdPlanId = createRes.body.data.metadata.planId;
      const epicId = createRes.body.data.metadata.beadEpicId;
      const gateTaskId = createRes.body.data.metadata.gateTaskId;

      // Ship the plan so tasks become ready
      const shipRes = await request(app).post(`${API_PREFIX}/projects/${projectId}/plans/${createdPlanId}/ship`);
      expect(shipRes.status).toBe(200);

      const project = await projectService.getProject(projectId);
      const allIssues = await beads.listAll(project.repoPath);
      const planTasks = allIssues.filter(
        (i: { id: string; issue_type?: string; type?: string }) =>
          i.id.startsWith(epicId + ".") && i.id !== gateTaskId && (i.issue_type ?? i.type) !== "epic",
      );

      const taskA = planTasks.find((t: { title: string }) => t.title === "Task A");
      const taskB = planTasks.find((t: { title: string }) => t.title === "Task B");
      const taskC = planTasks.find((t: { title: string }) => t.title === "Task C");
      expect(taskA).toBeDefined();
      expect(taskB).toBeDefined();
      expect(taskC).toBeDefined();

      // Claim Task B to put it in_progress
      await beads.update(project.repoPath, (taskB as { id: string }).id, {
        status: "in_progress",
        assignee: "test-user",
        claim: true,
      });
      await beads.sync(project.repoPath);

      // Archive the plan
      const archiveRes = await request(app).post(`${API_PREFIX}/projects/${projectId}/plans/${createdPlanId}/archive`);
      expect(archiveRes.status).toBe(200);

      // Verify: Task A and Task C should be closed; Task B (in_progress) should remain in_progress
      const afterArchive = await beads.listAll(project.repoPath);
      const taskAAfter = afterArchive.find((i: { id: string }) => i.id === (taskA as { id: string }).id);
      const taskBAfter = afterArchive.find((i: { id: string }) => i.id === (taskB as { id: string }).id);
      const taskCAfter = afterArchive.find((i: { id: string }) => i.id === (taskC as { id: string }).id);

      expect((taskAAfter as { status: string }).status).toBe("closed");
      expect((taskBAfter as { status: string }).status).toBe("in_progress");
      expect((taskCAfter as { status: string }).status).toBe("closed");
    },
  );

  it("POST /projects/:id/plans/:planId/archive returns 400 when plan has no epic", async () => {
    const app = createApp();
    const planBody = {
      title: "No Epic Plan",
      content: "# No Epic\n\nManually created without beads.",
      complexity: "low",
    };
    const createRes = await request(app).post(`${API_PREFIX}/projects/${projectId}/plans`).send(planBody);
    expect(createRes.status).toBe(201);
    const planId = createRes.body.data.metadata.planId;

    // Remove beadEpicId from metadata to simulate plan without epic
    const plansDir = path.join((await projectService.getProject(projectId)).repoPath, ".opensprint", "plans");
    const metaPath = path.join(plansDir, `${planId}.meta.json`);
    const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
    meta.beadEpicId = "";
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

    const archiveRes = await request(app).post(`${API_PREFIX}/projects/${projectId}/plans/${planId}/archive`);
    expect(archiveRes.status).toBe(400);
    expect(archiveRes.body.error?.code).toBe("NO_EPIC");
  });
});
