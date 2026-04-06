import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { localhostCors } from "../middleware/cors.js";

function createTestApp() {
  const app = express();
  app.use(localhostCors);
  app.get("/test", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("localhostCors", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    app = createTestApp();
  });

  it("allows requests with no Origin header", async () => {
    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("allows http://localhost:5173", async () => {
    const res = await request(app).get("/test").set("Origin", "http://localhost:5173");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("allows http://127.0.0.1:3100", async () => {
    const res = await request(app).get("/test").set("Origin", "http://127.0.0.1:3100");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3100");
  });

  it("allows http://localhost (no port)", async () => {
    const res = await request(app).get("/test").set("Origin", "http://localhost");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost");
  });

  it("allows http://127.0.0.1 (no port)", async () => {
    const res = await request(app).get("/test").set("Origin", "http://127.0.0.1");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1");
  });

  it("blocks https://evil.com", async () => {
    const res = await request(app).get("/test").set("Origin", "https://evil.com");
    expect(res.status).toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("blocks https://localhost.evil.com", async () => {
    const res = await request(app).get("/test").set("Origin", "https://localhost.evil.com");
    expect(res.status).toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("blocks http://192.168.1.1:3100", async () => {
    const res = await request(app).get("/test").set("Origin", "http://192.168.1.1:3100");
    expect(res.status).toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("responds to preflight OPTIONS with correct headers for allowed origin", async () => {
    const res = await request(app)
      .options("/test")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "GET");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("rejects preflight OPTIONS for disallowed origin", async () => {
    const res = await request(app)
      .options("/test")
      .set("Origin", "https://attacker.io")
      .set("Access-Control-Request-Method", "GET");
    expect(res.status).toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
