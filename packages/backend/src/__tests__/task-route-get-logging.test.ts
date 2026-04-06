import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createTasksRouter } from "../routes/tasks.js";
import type { TaskService } from "../services/task.service.js";
import { requestIdMiddleware } from "../middleware/request-id.js";
import { requireLocalSessionAuth } from "../middleware/require-local-session-auth.js";
import { API_PREFIX } from "@opensprint/shared";
import { resetLogLevelCache } from "../utils/logger.js";
import { withLocalSessionAuth } from "./local-auth-test-helpers.js";

/**
 * Slow GET /:taskId can flake under parallel vitest with supertest ("Parse Error: Expected HTTP/…").
 * Longer timeout + one retry matches the env-route suite pattern for merge-gate stability.
 */
async function getTaskDetail(app: express.Express, url: string) {
  const doRequest = () =>
    withLocalSessionAuth(request(app).get(url).timeout(10_000));
  try {
    return await doRequest();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/socket hang up|Parse Error/i.test(msg)) {
      return await doRequest();
    }
    throw err;
  }
}

describe("GET /:taskId logging", () => {
  const originalLogLevel = process.env.LOG_LEVEL;
  let mockGetTask: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let app: express.Express;

  const fakeTask = {
    id: "os-abc.1",
    title: "Test Task",
    status: "open",
    priority: 1,
    type: "task",
    planId: "plan-1",
    description: "Test",
  };

  beforeEach(() => {
    process.env.LOG_LEVEL = "warn";
    resetLogLevelCache();
    mockGetTask = vi.fn().mockResolvedValue(fakeTask);
    const taskService = {
      getTask: mockGetTask,
    } as unknown as TaskService;

    app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(API_PREFIX, requireLocalSessionAuth);
    app.use(`${API_PREFIX}/projects/:projectId/tasks`, createTasksRouter(taskService));

    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.LOG_LEVEL = originalLogLevel;
    resetLogLevelCache();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("does not log info on normal (fast) requests", async () => {
    const res = await getTaskDetail(
      app,
      `${API_PREFIX}/projects/proj-1/tasks/os-abc.1`
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(fakeTask);

    const infoCalls = logSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" && call[0].includes("GET /:taskId") && !call[0].includes("slow")
    );
    expect(infoCalls).toHaveLength(0);
  });

  it("logs warning when request is slow (>500ms)", async () => {
    mockGetTask.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(fakeTask), 600);
        })
    );

    const res = await getTaskDetail(
      app,
      `${API_PREFIX}/projects/proj-1/tasks/os-abc.1`
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(fakeTask);

    const warnCalls = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("GET /:taskId slow")
    );
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
    expect(warnCalls[0][0]).toContain("GET /:taskId slow");
    expect(warnCalls[0][0]).toContain("durationMs");
  });
});
