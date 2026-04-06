import { describe, it, expect, beforeEach, afterEach, vi, assert } from "vitest";
import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { API_PREFIX } from "@opensprint/shared";
import { errorHandler } from "../middleware/error-handler.js";
import {
  getGlobalSettings,
  setGlobalSettings,
  setGlobalSettingsPathForTesting,
} from "../services/global-settings.service.js";
import { setBackendRuntimeInfoForTesting } from "../utils/runtime-info.js";
import { authedSupertest } from "./local-auth-test-helpers.js";

const mockExecFile = vi.fn();

/** No importOriginal — avoids loading real child_process graph alongside env in parallel workers. */
vi.mock("node:child_process", () => ({
  exec: vi.fn(
    (
      _cmd: string,
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void
    ) => {
      setImmediate(() => cb(null, "", ""));
      return {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
      };
    }
  ),
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

const mockValidateApiKey = vi.fn();

/**
 * Stub at the env route boundary (preferred) and models re-export (models import surface test).
 * Prevents env.ts from pulling real models.ts (SDK init / network) regardless of module graph order.
 */
vi.mock("../routes/env-keys-validate.js", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

/**
 * Full stub of models.js (not importOriginal / partial mock). env.ts imports validateApiKey via
 * env-keys-validate → models; replacing models prevents any worker from evaluating models.ts
 * (Anthropic/OpenAI SDK init and network code).
 */
vi.mock("../routes/models.js", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

vi.mock("../services/task-store.service.js", () => ({
  taskStore: {
    init: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    listAll: vi.fn().mockResolvedValue([]),
    listInProgressWithAgentAssignee: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
    ready: vi.fn().mockResolvedValue([]),
    addDependency: vi.fn().mockResolvedValue(undefined),
    syncForPush: vi.fn().mockResolvedValue(undefined),
  },
  TaskStoreService: vi.fn(),
  SCHEMA_SQL: "",
}));

import { envRouter, setEnvPathForTesting } from "../routes/env.js";

function createMinimalEnvApp() {
  const app = express();
  app.use(express.json());
  app.use(`${API_PREFIX}/env`, envRouter);
  app.use(errorHandler);
  return app;
}

type EnvMinimalApp = ReturnType<typeof createMinimalEnvApp>;

function isTransientSupertestTransportError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string"
      ? (err as { code: string }).code
      : "";
  return (
    /socket hang up|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|timeout|ECONNREFUSED/i.test(msg) ||
    /socket hang up|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|timeout|ECONNREFUSED/i.test(code)
  );
}

/**
 * GET `/env/global-status` with timeout and limited retries on transient supertest transport errors.
 *
 * Regression: intermittent `socket hang up` / connection drops in this suite have caused
 * merge-gate failures (`npm run test`). A single retry was insufficient under heavy parallel
 * load; we retry a few times with the same 10s per-attempt cap.
 */
async function getGlobalStatus(app: EnvMinimalApp) {
  const url = `${API_PREFIX}/env/global-status`;
  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await authedSupertest(app).get(url).timeout(10_000);
    } catch (err: unknown) {
      lastErr = err;
      if (!isTransientSupertestTransportError(err) || attempt === maxAttempts - 1) {
        throw err;
      }
    }
  }
  throw lastErr;
}

/**
 * POST `/env/keys` with timeout and limited retries on transient supertest transport errors.
 * Same flake class as `getGlobalStatus` when this suite runs in the full `npm run test` graph.
 */
async function postEnvKeys(app: EnvMinimalApp, body: object) {
  const url = `${API_PREFIX}/env/keys`;
  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await authedSupertest(app).post(url).send(body).timeout(10_000);
    } catch (err: unknown) {
      lastErr = err;
      if (!isTransientSupertestTransportError(err) || attempt === maxAttempts - 1) {
        throw err;
      }
    }
  }
  throw lastErr;
}

describe("Env API", () => {
  let app: ReturnType<typeof createMinimalEnvApp>;
  let tmpDir: string;

  beforeEach(() => {
    assert(
      vi.isMockFunction(mockValidateApiKey),
      "validateApiKey must be a vi.fn() stub — the real models.js was loaded, which causes network calls"
    );
    app = createMinimalEnvApp();
    vi.clearAllMocks();
    mockValidateApiKey.mockReset();
    mockExecFile.mockReset();
    mockExecFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout?: string, stderr?: string) => void
      ) => {
        setImmediate(() => cb(null, "", ""));
        return {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
        };
      }
    );
    tmpDir = path.join(
      os.tmpdir(),
      `env-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    const envPath = path.join(tmpDir, ".env");
    fs.writeFileSync(envPath, "", "utf-8");
    setEnvPathForTesting(envPath);
    setGlobalSettingsPathForTesting(path.join(tmpDir, ".opensprint", "global-settings.json"));
  });

  afterEach(() => {
    setEnvPathForTesting(null);
    setGlobalSettingsPathForTesting(null);
    setBackendRuntimeInfoForTesting(null);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("POST /env/keys/validate", () => {
    it("models module is fully stubbed (only validateApiKey export; no real models.ts surface)", async () => {
      const m = await import("../routes/models.js");
      expect(Object.keys(m).sort()).toEqual(["validateApiKey"]);

      const sentinel = { valid: true, __guard: true };
      mockValidateApiKey.mockResolvedValueOnce(sentinel);
      const result = await m.validateApiKey("claude", "test");
      expect(result).toBe(sentinel);
      expect(mockValidateApiKey).toHaveBeenCalledWith("claude", "test");
    });

    it("returns 400 when provider and value are missing", async () => {
      const res = await authedSupertest(app).post(`${API_PREFIX}/env/keys/validate`).send({});
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION_ERROR");
      expect(res.body.error?.message).toMatch(/provider|value|required|option|invalid/i);
      expect(mockValidateApiKey).not.toHaveBeenCalled();
    });

    it("returns 400 when provider is not claude, cursor, openai, or google", async () => {
      const res = await authedSupertest(app).post(`${API_PREFIX}/env/keys/validate`).send({ provider: "unknown", value: "sk-test" });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION_ERROR");
      expect(res.body.error?.message).toMatch(
        /provider|option|invalid|claude|cursor|openai|google/i
      );
      expect(mockValidateApiKey).not.toHaveBeenCalled();
    });

    it("returns valid: true when validation succeeds for Google", async () => {
      mockValidateApiKey.mockResolvedValue({ valid: true });

      const res = await authedSupertest(app).post(`${API_PREFIX}/env/keys/validate`).send({ provider: "google", value: "AIza-test" });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ valid: true });
      expect(mockValidateApiKey).toHaveBeenCalledWith("google", "AIza-test");
    });

    it("returns valid: true when validation succeeds for OpenAI", async () => {
      mockValidateApiKey.mockResolvedValue({ valid: true });

      const res = await authedSupertest(app).post(`${API_PREFIX}/env/keys/validate`).send({ provider: "openai", value: "sk-openai-test" });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ valid: true });
      expect(mockValidateApiKey).toHaveBeenCalledWith("openai", "sk-openai-test");
    });

    it("returns valid: true when validation succeeds for Claude", async () => {
      mockValidateApiKey.mockResolvedValue({ valid: true });

      const res = await authedSupertest(app).post(`${API_PREFIX}/env/keys/validate`).send({ provider: "claude", value: "sk-ant-test" });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ valid: true });
      expect(mockValidateApiKey).toHaveBeenCalledWith("claude", "sk-ant-test");
    });

    it("returns valid: true when validation succeeds for Cursor", async () => {
      mockValidateApiKey.mockResolvedValue({ valid: true });

      const res = await authedSupertest(app).post(`${API_PREFIX}/env/keys/validate`).send({ provider: "cursor", value: "cursor-key-123" });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ valid: true });
      expect(mockValidateApiKey).toHaveBeenCalledWith("cursor", "cursor-key-123");
    });

    it("returns valid: false with error when validation fails", async () => {
      mockValidateApiKey.mockResolvedValue({
        valid: false,
        error: "Invalid API key",
      });

      const res = await authedSupertest(app).post(`${API_PREFIX}/env/keys/validate`).send({ provider: "claude", value: "bad-key" });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ valid: false, error: "Invalid API key" });
      expect(mockValidateApiKey).toHaveBeenCalledWith("claude", "bad-key");
    });
  });

  describe("GET /env/keys", () => {
    it("does not invoke validateApiKey (no network / models.ts for this route)", async () => {
      mockValidateApiKey.mockClear();
      const res = await authedSupertest(app).get(`${API_PREFIX}/env/keys`);
      expect(res.status).toBe(200);
      expect(mockValidateApiKey).not.toHaveBeenCalled();
    });

    it("returns shape with anthropic, cursor, openai, google, claudeCli, cursorCli, ollamaCli, useCustomCli booleans", async () => {
      const res = await authedSupertest(app).get(`${API_PREFIX}/env/keys`);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(typeof res.body.data.anthropic).toBe("boolean");
      expect(typeof res.body.data.cursor).toBe("boolean");
      expect(typeof res.body.data.openai).toBe("boolean");
      expect(typeof res.body.data.google).toBe("boolean");
      expect(typeof res.body.data.claudeCli).toBe("boolean");
      expect(typeof res.body.data.cursorCli).toBe("boolean");
      expect(typeof res.body.data.ollamaCli).toBe("boolean");
      expect(typeof res.body.data.useCustomCli).toBe("boolean");
    });

    it("reports ollamaCli when the Ollama binary is available on PATH", async () => {
      mockExecFile.mockImplementation(
        (
          _file: string,
          args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout?: string, stderr?: string) => void
        ) => {
          const binary = args[0];
          if (binary === "ollama") {
            setImmediate(() => cb(null, "/usr/local/bin/ollama\n", ""));
          } else {
            const err = Object.assign(new Error(`${binary} not found`), { code: "ENOENT" });
            setImmediate(() => cb(err));
          }
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
          };
        }
      );

      const res = await authedSupertest(app).get(`${API_PREFIX}/env/keys`);

      expect(res.status).toBe(200);
      expect(res.body.data.ollamaCli).toBe(true);
      expect(res.body.data.claudeCli).toBe(false);
      expect(res.body.data.cursorCli).toBe(false);
    });

    it("anthropic true when global store has ANTHROPIC_API_KEY", async () => {
      await setGlobalSettings({
        apiKeys: {
          ANTHROPIC_API_KEY: [{ id: "k1", value: "sk-ant-xxx" }],
        },
      });

      const res = await authedSupertest(app).get(`${API_PREFIX}/env/keys`);
      expect(res.status).toBe(200);
      expect(res.body.data.anthropic).toBe(true);
    });

    it("cursor true when global store has CURSOR_API_KEY", async () => {
      await setGlobalSettings({
        apiKeys: {
          CURSOR_API_KEY: [{ id: "k2", value: "cursor-xxx" }],
        },
      });

      const res = await authedSupertest(app).get(`${API_PREFIX}/env/keys`);
      expect(res.status).toBe(200);
      expect(res.body.data.cursor).toBe(true);
    });

    it("anthropic true when process.env has ANTHROPIC_API_KEY", async () => {
      const original = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      try {
        const res = await authedSupertest(app).get(`${API_PREFIX}/env/keys`);
        expect(res.status).toBe(200);
        expect(res.body.data.anthropic).toBe(true);
      } finally {
        process.env.ANTHROPIC_API_KEY = original;
      }
    });

    it("cursor true when process.env has CURSOR_API_KEY", async () => {
      const original = process.env.CURSOR_API_KEY;
      process.env.CURSOR_API_KEY = "cursor-test-key";

      try {
        const res = await authedSupertest(app).get(`${API_PREFIX}/env/keys`);
        expect(res.status).toBe(200);
        expect(res.body.data.cursor).toBe(true);
      } finally {
        process.env.CURSOR_API_KEY = original;
      }
    });

    it("openai true when global store has OPENAI_API_KEY", async () => {
      await setGlobalSettings({
        apiKeys: {
          OPENAI_API_KEY: [{ id: "k3", value: "sk-openai-xxx" }],
        },
      });

      const res = await authedSupertest(app).get(`${API_PREFIX}/env/keys`);
      expect(res.status).toBe(200);
      expect(res.body.data.openai).toBe(true);
    });

    it("google true when global store has GOOGLE_API_KEY", async () => {
      await setGlobalSettings({
        apiKeys: {
          GOOGLE_API_KEY: [{ id: "k4", value: "AIza-xxx" }],
        },
      });

      const res = await authedSupertest(app).get(`${API_PREFIX}/env/keys`);
      expect(res.status).toBe(200);
      expect(res.body.data.google).toBe(true);
    });

    it("openai true when process.env has OPENAI_API_KEY", async () => {
      const original = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "sk-openai-test";

      try {
        const res = await authedSupertest(app).get(`${API_PREFIX}/env/keys`);
        expect(res.status).toBe(200);
        expect(res.body.data.openai).toBe(true);
      } finally {
        process.env.OPENAI_API_KEY = original;
      }
    });

    it("useCustomCli reflects global settings", async () => {
      await setGlobalSettings({ useCustomCli: true });

      const res = await authedSupertest(app).get(`${API_PREFIX}/env/keys`);
      expect(res.status).toBe(200);
      expect(res.body.data.useCustomCli).toBe(true);
    });
  });

  describe("GET /env/prerequisites", () => {
    it("returns missing list and platform", async () => {
      setBackendRuntimeInfoForTesting({
        platform: "darwin",
        isWsl: false,
        wslDistroName: null,
        repoPathPolicy: "any",
      });

      const res = await authedSupertest(app).get(`${API_PREFIX}/env/prerequisites`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("missing");
      expect(Array.isArray(res.body.data.missing)).toBe(true);
      expect(res.body.data.missing.every((s: unknown) => typeof s === "string")).toBe(true);
      expect(["Git", "Node.js"]).toEqual(expect.arrayContaining(res.body.data.missing as string[]));
      expect(res.body.data.platform).toBe("darwin");
    });
  });

  describe("GET /env/runtime", () => {
    it("returns native Linux runtime info", async () => {
      setBackendRuntimeInfoForTesting({
        platform: "linux",
        isWsl: false,
        wslDistroName: null,
        repoPathPolicy: "any",
      });

      const res = await authedSupertest(app).get(`${API_PREFIX}/env/runtime`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        platform: "linux",
        isWsl: false,
        wslDistroName: null,
        repoPathPolicy: "any",
      });
      const pol = res.body.data.fsBrowsePolicy;
      expect(pol).toBeDefined();
      expect(typeof pol.homeBrowseEnvRequested).toBe("boolean");
      expect(typeof pol.homeBrowseEffective).toBe("boolean");
      expect(typeof pol.homeBrowseSuppressedByCi).toBe("boolean");
      expect(typeof pol.fsRootConfigured).toBe("boolean");
      expect(pol.adminWarning === null || typeof pol.adminWarning === "string").toBe(true);
    });

    it("returns WSL runtime info with distro name", async () => {
      setBackendRuntimeInfoForTesting({
        platform: "linux",
        isWsl: true,
        wslDistroName: "Ubuntu",
        repoPathPolicy: "linux_fs_only",
      });

      const res = await authedSupertest(app).get(`${API_PREFIX}/env/runtime`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        platform: "linux",
        isWsl: true,
        wslDistroName: "Ubuntu",
        repoPathPolicy: "linux_fs_only",
      });
      const pol = res.body.data.fsBrowsePolicy;
      expect(pol).toBeDefined();
      expect(typeof pol.homeBrowseEnvRequested).toBe("boolean");
      expect(typeof pol.adminWarning === "string" || pol.adminWarning === null).toBe(true);
    });
  });

  describe("POST /env/cursor-cli-install", () => {
    it("returns 200 with install instructions instead of executing remote scripts", async () => {
      const res = await authedSupertest(app).post(`${API_PREFIX}/env/cursor-cli-install`);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.success).toBe(true);
      expect(typeof res.body.data.message).toBe("string");
      expect(res.body.data.message).toMatch(/review|run|terminal/i);
    });

    it("returns installUrl and manualCommand for the current platform", async () => {
      const res = await authedSupertest(app).post(`${API_PREFIX}/env/cursor-cli-install`);
      expect(res.status).toBe(200);
      const { installUrl, manualCommand, platform } = res.body.data;
      expect(typeof installUrl).toBe("string");
      expect(installUrl).toMatch(/^https:\/\/cursor\.com\/install/);
      expect(typeof manualCommand).toBe("string");
      expect(manualCommand.length).toBeGreaterThan(0);
      expect(typeof platform).toBe("string");
      expect(platform).toBe(process.platform);
    });

    it("does not execute child processes (no curl|bash or irm|iex)", async () => {
      const { exec: mockExec } = await import("node:child_process");
      const execSpy = vi.mocked(mockExec);
      const callsBefore = execSpy.mock.calls.length;

      await authedSupertest(app).post(`${API_PREFIX}/env/cursor-cli-install`);

      for (const call of execSpy.mock.calls.slice(callsBefore)) {
        const cmd = String(call[0]);
        expect(cmd).not.toMatch(/curl.*\|.*bash/);
        expect(cmd).not.toMatch(/irm.*\|.*iex/);
      }
    });

    it("returns unix-style command on non-win32 platforms", async () => {
      const res = await authedSupertest(app).post(`${API_PREFIX}/env/cursor-cli-install`);
      if (process.platform !== "win32") {
        expect(res.body.data.manualCommand).toContain("curl");
        expect(res.body.data.installUrl).toBe("https://cursor.com/install");
      }
    });
  });

  describe("POST /env/keys", () => {
    it("returns 400 when key and value are missing", async () => {
      const res = await postEnvKeys(app, {});
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when key is not allowed", async () => {
      const res = await postEnvKeys(app, {
        key: "OTHER_KEY",
        value: "secret",
      });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when value is empty", async () => {
      const res = await postEnvKeys(app, {
        key: "ANTHROPIC_API_KEY",
        value: "   ",
      });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("INVALID_INPUT");
    });

    it("saves allowed key to .env and returns 200", async () => {
      const res = await postEnvKeys(app, {
        key: "ANTHROPIC_API_KEY",
        value: "sk-test-value",
      });
      expect(res.status).toBe(200);
      expect(res.body.data?.saved).toBe(true);

      const content = fs.readFileSync(path.join(tmpDir, ".env"), "utf-8");
      expect(content).toMatch(/ANTHROPIC_API_KEY=.*sk-test-value/);
    });

    it("appends to existing .env without stripping other keys", async () => {
      fs.writeFileSync(path.join(tmpDir, ".env"), "EXISTING=ok\n", "utf-8");

      await postEnvKeys(app, {
        key: "CURSOR_API_KEY",
        value: "cursor-secret",
      });

      const content = fs.readFileSync(path.join(tmpDir, ".env"), "utf-8");
      expect(content).toMatch(/EXISTING=ok/);
      expect(content).toMatch(/CURSOR_API_KEY=.*cursor-secret/);
    });

    it("persists to global store with unique id", async () => {
      await postEnvKeys(app, {
        key: "ANTHROPIC_API_KEY",
        value: "sk-ant-global-test",
      });

      const settings = await getGlobalSettings();
      const entries = settings.apiKeys?.ANTHROPIC_API_KEY;
      expect(entries).toBeDefined();
      expect(entries).toHaveLength(1);
      expect(entries![0].value).toBe("sk-ant-global-test");
      expect(entries![0].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("merges new key with existing global apiKeys", async () => {
      await setGlobalSettings({
        apiKeys: {
          ANTHROPIC_API_KEY: [{ id: "existing-1", value: "sk-ant-old" }],
        },
      });

      await postEnvKeys(app, {
        key: "ANTHROPIC_API_KEY",
        value: "sk-ant-new",
      });

      const settings = await getGlobalSettings();
      const entries = settings.apiKeys?.ANTHROPIC_API_KEY;
      expect(entries).toHaveLength(2);
      expect(entries![0]).toEqual({ id: "existing-1", value: "sk-ant-old" });
      expect(entries![1].value).toBe("sk-ant-new");
      expect(entries![1].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("adds key to different provider without affecting others", async () => {
      await setGlobalSettings({
        apiKeys: {
          ANTHROPIC_API_KEY: [{ id: "a1", value: "sk-ant-xxx" }],
        },
      });

      await postEnvKeys(app, {
        key: "CURSOR_API_KEY",
        value: "cursor-new",
      });

      const settings = await getGlobalSettings();
      expect(settings.apiKeys?.ANTHROPIC_API_KEY).toHaveLength(1);
      expect(settings.apiKeys?.CURSOR_API_KEY).toHaveLength(1);
      expect(settings.apiKeys?.CURSOR_API_KEY![0].value).toBe("cursor-new");
    });

    it("saves OPENAI_API_KEY to .env and global store", async () => {
      const res = await postEnvKeys(app, {
        key: "OPENAI_API_KEY",
        value: "sk-openai-test-value",
      });
      expect(res.status).toBe(200);
      expect(res.body.data?.saved).toBe(true);

      const content = fs.readFileSync(path.join(tmpDir, ".env"), "utf-8");
      expect(content).toMatch(/OPENAI_API_KEY=.*sk-openai-test-value/);

      const settings = await getGlobalSettings();
      expect(settings.apiKeys?.OPENAI_API_KEY).toHaveLength(1);
      expect(settings.apiKeys?.OPENAI_API_KEY![0].value).toBe("sk-openai-test-value");
    });
  });

  describe("GET /env/global-status", () => {
    it("returns hasAnyKey and useCustomCli", async () => {
      const res = await getGlobalStatus(app);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(typeof res.body.data.hasAnyKey).toBe("boolean");
      expect(typeof res.body.data.useCustomCli).toBe("boolean");
    });

    it("hasAnyKey true when global store has keys", async () => {
      await setGlobalSettings({
        apiKeys: {
          ANTHROPIC_API_KEY: [{ id: "k1", value: "sk-ant-xxx" }],
        },
      });

      const res = await getGlobalStatus(app);
      expect(res.status).toBe(200);
      expect(res.body.data.hasAnyKey).toBe(true);
    });

    it("hasAnyKey true when global store has OPENAI_API_KEY", async () => {
      await setGlobalSettings({
        apiKeys: {
          OPENAI_API_KEY: [{ id: "k3", value: "sk-openai-xxx" }],
        },
      });

      const res = await getGlobalStatus(app);
      expect(res.status).toBe(200);
      expect(res.body.data.hasAnyKey).toBe(true);
    });

    it("hasAnyKey true when process.env has ANTHROPIC_API_KEY", async () => {
      const original = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      try {
        const res = await getGlobalStatus(app);
        expect(res.status).toBe(200);
        expect(res.body.data.hasAnyKey).toBe(true);
      } finally {
        process.env.ANTHROPIC_API_KEY = original;
      }
    });

    it("hasAnyKey true when process.env has CURSOR_API_KEY", async () => {
      const original = process.env.CURSOR_API_KEY;
      process.env.CURSOR_API_KEY = "cursor-test-key";

      try {
        const res = await getGlobalStatus(app);
        expect(res.status).toBe(200);
        expect(res.body.data.hasAnyKey).toBe(true);
      } finally {
        process.env.CURSOR_API_KEY = original;
      }
    });

    it("hasAnyKey true when process.env has OPENAI_API_KEY", async () => {
      const original = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "sk-openai-test";

      try {
        const res = await getGlobalStatus(app);
        expect(res.status).toBe(200);
        expect(res.body.data.hasAnyKey).toBe(true);
      } finally {
        process.env.OPENAI_API_KEY = original;
      }
    });

    it("useCustomCli reflects global settings", async () => {
      await setGlobalSettings({ useCustomCli: true });

      const res = await getGlobalStatus(app);
      expect(res.status).toBe(200);
      expect(res.body.data.useCustomCli).toBe(true);
    });
  });

  describe("PUT /env/global-settings", () => {
    it("updates useCustomCli and returns it", async () => {
      const res = await authedSupertest(app)
        .put(`${API_PREFIX}/env/global-settings`)
        .send({ useCustomCli: true });

      expect(res.status).toBe(200);
      expect(res.body.data.useCustomCli).toBe(true);

      const statusRes = await getGlobalStatus(app);
      expect(statusRes.body.data.useCustomCli).toBe(true);
    });

    it("persists useCustomCli across requests", async () => {
      const putRes = await authedSupertest(app)
        .put(`${API_PREFIX}/env/global-settings`)
        .send({ useCustomCli: true })
        .timeout(10_000);
      expect(putRes.status).toBe(200);
      expect(putRes.body.data?.useCustomCli).toBe(true);

      const res = await getGlobalStatus(app);
      expect(res.status).toBe(200);
      expect(res.body.data.useCustomCli).toBe(true);
    });

    it("returns current useCustomCli when body has no valid updates", async () => {
      await setGlobalSettings({ useCustomCli: true });

      const res = await authedSupertest(app).put(`${API_PREFIX}/env/global-settings`).send({});

      expect(res.status).toBe(200);
      expect(res.body.data.useCustomCli).toBe(true);
    });

    it("can set useCustomCli to false", async () => {
      await setGlobalSettings({ useCustomCli: true });

      const res = await authedSupertest(app)
        .put(`${API_PREFIX}/env/global-settings`)
        .send({ useCustomCli: false });

      expect(res.status).toBe(200);
      expect(res.body.data.useCustomCli).toBe(false);
    });
  });
});
