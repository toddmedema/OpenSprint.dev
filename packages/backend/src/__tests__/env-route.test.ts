import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import os from "os";
import { createApp } from "../app.js";
import { API_PREFIX } from "@opensprint/shared";
import { setEnvPathForTesting } from "../routes/env.js";

describe("Env API", () => {
  let app: ReturnType<typeof createApp>;
  let tmpDir: string;

  beforeEach(() => {
    app = createApp();
    tmpDir = path.join(
      os.tmpdir(),
      `env-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    const envPath = path.join(tmpDir, ".env");
    fs.writeFileSync(envPath, "", "utf-8");
    setEnvPathForTesting(envPath);
  });

  afterEach(() => {
    setEnvPathForTesting(null);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("GET /env/keys", () => {
    it("returns shape with anthropic, cursor, claudeCli booleans", async () => {
      const res = await request(app).get(`${API_PREFIX}/env/keys`);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(typeof res.body.data.anthropic).toBe("boolean");
      expect(typeof res.body.data.cursor).toBe("boolean");
      expect(typeof res.body.data.claudeCli).toBe("boolean");
    });
  });

  describe("POST /env/keys", () => {
    it("returns 400 when key and value are missing", async () => {
      const res = await request(app).post(`${API_PREFIX}/env/keys`).send({});
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("INVALID_INPUT");
    });

    it("returns 400 when key is not allowed", async () => {
      const res = await request(app)
        .post(`${API_PREFIX}/env/keys`)
        .send({ key: "OTHER_KEY", value: "secret" });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("INVALID_KEY");
    });

    it("returns 400 when value is empty", async () => {
      const res = await request(app)
        .post(`${API_PREFIX}/env/keys`)
        .send({ key: "ANTHROPIC_API_KEY", value: "   " });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("INVALID_INPUT");
    });

    it("saves allowed key to .env and returns 200", async () => {
      const res = await request(app)
        .post(`${API_PREFIX}/env/keys`)
        .send({ key: "ANTHROPIC_API_KEY", value: "sk-test-value" });
      expect(res.status).toBe(200);
      expect(res.body.data?.saved).toBe(true);

      const content = fs.readFileSync(path.join(tmpDir, ".env"), "utf-8");
      expect(content).toMatch(/ANTHROPIC_API_KEY=.*sk-test-value/);
    });

    it("appends to existing .env without stripping other keys", async () => {
      fs.writeFileSync(path.join(tmpDir, ".env"), "EXISTING=ok\n", "utf-8");

      await request(app)
        .post(`${API_PREFIX}/env/keys`)
        .send({ key: "CURSOR_API_KEY", value: "cursor-secret" });

      const content = fs.readFileSync(path.join(tmpDir, ".env"), "utf-8");
      expect(content).toMatch(/EXISTING=ok/);
      expect(content).toMatch(/CURSOR_API_KEY=.*cursor-secret/);
    });
  });
});
