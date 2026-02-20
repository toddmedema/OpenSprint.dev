import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { createApp } from "../app.js";
import { ProjectService } from "../services/project.service.js";
import { API_PREFIX, DEFAULT_HIL_CONFIG } from "@opensprint/shared";

const execAsync = promisify(exec);

describe("Deliver API (phase routes for deployment records)", () => {
  let app: ReturnType<typeof createApp>;
  let projectService: ProjectService;
  let tempDir: string;
  let projectId: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    app = createApp();
    projectService = new ProjectService();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opensprint-deploy-route-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    const repoPath = path.join(tempDir, "my-project");
    await fs.mkdir(repoPath, { recursive: true });
    await fs.writeFile(
      path.join(repoPath, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { test: "echo 'Tests: 1 passed, 0 failed, 1 total'" },
      })
    );
    await execAsync("git init && git add -A && git commit -m init", { cwd: repoPath });
    const project = await projectService.createProject({
      name: "Deploy Test Project",
      repoPath,
      planningAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
      codingAgent: { type: "claude", model: "claude-sonnet-4", cliCommand: null },
      deployment: {
        mode: "custom",
        customCommand: "echo deployed",
        rollbackCommand: "echo rolled-back",
        target: "staging",
      },
      hilConfig: DEFAULT_HIL_CONFIG,
    });
    projectId = project.id;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await new Promise((r) => setTimeout(r, 1000));
    await fs
      .rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
      .catch(() => {});
  });

  describe("GET /projects/:projectId/deliver/status", () => {
    it("should return deliver status for existing project", async () => {
      const res = await request(app).get(`${API_PREFIX}/projects/${projectId}/deliver/status`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data).toMatchObject({
        activeDeployId: null,
      });
      expect(res.body.data.currentDeploy).toBeNull();
    });

    it("should return 404 for non-existent project", async () => {
      const res = await request(app).get(`${API_PREFIX}/projects/nonexistent-id/deliver/status`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe("PROJECT_NOT_FOUND");
    });
  });

  describe("GET /projects/:projectId/deliver/history", () => {
    it("should return empty history for new project", async () => {
      const res = await request(app).get(`${API_PREFIX}/projects/${projectId}/deliver/history`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("should return 404 for non-existent project", async () => {
      const res = await request(app).get(`${API_PREFIX}/projects/nonexistent-id/deliver/history`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });
  });

  describe("POST /projects/:projectId/deliver", () => {
    it("should accept deploy and return deployId", async () => {
      const res = await request(app).post(`${API_PREFIX}/projects/${projectId}/deliver`);

      expect(res.status).toBe(202);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.deployId).toBeDefined();
      expect(typeof res.body.data.deployId).toBe("string");
    });

    it("should return 404 for non-existent project", async () => {
      const res = await request(app).post(`${API_PREFIX}/projects/nonexistent-id/deliver`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });
  });

  describe("PUT /projects/:projectId/deliver/settings", () => {
    it("should update deployment settings", async () => {
      const res = await request(app)
        .put(`${API_PREFIX}/projects/${projectId}/deliver/settings`)
        .send({ mode: "custom", customCommand: "npm run deploy" });

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.deployment).toMatchObject({
        mode: "custom",
        customCommand: "npm run deploy",
      });
    });

    it("should accept and persist autoDeployOnEpicCompletion, autoDeployOnEvalResolution, and autoResolveFeedbackOnTaskCompletion (PRD §7.5.3, §10.2)", async () => {
      const res = await request(app)
        .put(`${API_PREFIX}/projects/${projectId}/deliver/settings`)
        .send({
          mode: "custom",
          autoDeployOnEpicCompletion: true,
          autoDeployOnEvalResolution: true,
          autoResolveFeedbackOnTaskCompletion: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.deployment.autoDeployOnEpicCompletion).toBe(true);
      expect(res.body.data.deployment.autoDeployOnEvalResolution).toBe(true);
      expect(res.body.data.deployment.autoResolveFeedbackOnTaskCompletion).toBe(true);

      const getRes = await request(app).get(`${API_PREFIX}/projects/${projectId}/settings`);
      expect(getRes.body.data.deployment.autoDeployOnEpicCompletion).toBe(true);
      expect(getRes.body.data.deployment.autoDeployOnEvalResolution).toBe(true);
      expect(getRes.body.data.deployment.autoResolveFeedbackOnTaskCompletion).toBe(true);
    });

    it("should accept and persist targets and envVars (PRD §7.5.2/7.5.4)", async () => {
      const res = await request(app)
        .put(`${API_PREFIX}/projects/${projectId}/deliver/settings`)
        .send({
          mode: "custom",
          targets: [
            { name: "staging", command: "echo deploy-staging", isDefault: true },
            { name: "production", webhookUrl: "https://api.example.com/deploy" },
          ],
          envVars: { NODE_ENV: "production", API_URL: "https://api.example.com" },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.deployment.targets).toHaveLength(2);
      expect(res.body.data.deployment.targets[0]).toMatchObject({
        name: "staging",
        command: "echo deploy-staging",
        isDefault: true,
      });
      expect(res.body.data.deployment.targets[1]).toMatchObject({
        name: "production",
        webhookUrl: "https://api.example.com/deploy",
      });
      expect(res.body.data.deployment.envVars).toEqual({
        NODE_ENV: "production",
        API_URL: "https://api.example.com",
      });

      const getRes = await request(app).get(`${API_PREFIX}/projects/${projectId}/settings`);
      expect(getRes.body.data.deployment.targets).toHaveLength(2);
      expect(getRes.body.data.deployment.envVars).toEqual({
        NODE_ENV: "production",
        API_URL: "https://api.example.com",
      });
    });
  });

  async function waitForHistoryCount(count: number, maxMs = 30_000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const res = await request(app).get(
        `${API_PREFIX}/projects/${projectId}/deliver/history?limit=10`
      );
      const completed = (res.body.data ?? []).filter(
        (r: { status: string }) => r.status !== "running" && r.status !== "pending"
      );
      if (completed.length >= count) return res.body.data;
      await new Promise((r) => setTimeout(r, 500));
    }
    const final = await request(app).get(
      `${API_PREFIX}/projects/${projectId}/deliver/history?limit=10`
    );
    return final.body.data ?? [];
  }

  describe("POST /projects/:projectId/deliver - record fields", () => {
    it(
      "should create deploy record with commitHash, target, mode from settings",
      { timeout: 30_000 },
      async () => {
        await request(app).post(`${API_PREFIX}/projects/${projectId}/deliver`);

        const history = await waitForHistoryCount(1);
        expect(history.length).toBeGreaterThan(0);

        const record = history[0];
        expect(record.target).toBe("staging");
        expect(record.mode).toBe("custom");
        expect(typeof record.commitHash === "string" || record.commitHash === null).toBe(true);
      }
    );

    it(
      "should deploy to specified target when body.target provided (PRD §7.5.4)",
      { timeout: 30_000 },
      async () => {
        await request(app)
          .put(`${API_PREFIX}/projects/${projectId}/deliver/settings`)
          .send({
            mode: "custom",
            targets: [
              { name: "staging", command: "echo deploy-staging", isDefault: true },
              { name: "production", command: "echo deploy-production" },
            ],
          });

        const res = await request(app)
          .post(`${API_PREFIX}/projects/${projectId}/deliver`)
          .send({ target: "production" });

        expect(res.status).toBe(202);
        expect(res.body.data.deployId).toBeDefined();

        const history = await waitForHistoryCount(1);
        const record = history[0];
        expect(record.target).toBe("production");
      }
    );
  });

  describe("POST /projects/:projectId/deliver/:deployId/rollback", () => {
    it("should mark original deploy as rolled_back on success", { timeout: 120_000 }, async () => {
      const res1 = await request(app).post(`${API_PREFIX}/projects/${projectId}/deliver`);
      expect(res1.status).toBe(202);
      await waitForHistoryCount(1);
      // Allow activeDeployments.delete() in .finally() to run before next deploy
      await new Promise((r) => setTimeout(r, 200));

      const res2 = await request(app).post(`${API_PREFIX}/projects/${projectId}/deliver`);
      expect(res2.status).toBe(202);
      const historyData = await waitForHistoryCount(2);
      await new Promise((r) => setTimeout(r, 200));

      expect(historyData.length).toBeGreaterThanOrEqual(2);
      const deployToRestore = historyData[1];
      const currentDeploy = historyData[0];

      const rollbackRes = await request(app).post(
        `${API_PREFIX}/projects/${projectId}/deliver/${deployToRestore.id}/rollback`
      );
      expect(rollbackRes.status).toBe(202);
      const rollbackDeployId = rollbackRes.body.data.deployId;

      await waitForHistoryCount(3);

      const historyRes = await request(app).get(
        `${API_PREFIX}/projects/${projectId}/deliver/history?limit=5`
      );
      const records = historyRes.body.data;

      const rollbackRecord = records.find((r: { id: string }) => r.id === rollbackDeployId);
      expect(rollbackRecord).toBeDefined();
      expect(rollbackRecord.status).toBe("success");

      const rolledBackRecord = records.find(
        (r: { id: string; rolledBackBy?: string }) => r.id === currentDeploy.id
      );
      expect(rolledBackRecord).toBeDefined();
      expect(rolledBackRecord.status).toBe("rolled_back");
      expect(rolledBackRecord.rolledBackBy).toBe(rollbackDeployId);
    });
  });
});
