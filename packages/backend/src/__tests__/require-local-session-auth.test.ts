import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { requireLocalSessionAuth } from "../middleware/require-local-session-auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import {
  setLocalSessionTokenForTesting,
  ensureLocalSessionToken,
  VITEST_DEFAULT_LOCAL_SESSION_TOKEN,
} from "../services/local-session-auth.service.js";

const TOKEN = "csrf-test-token";

function buildApp(): Express {
  const app = express();
  app.use(express.json());

  app.get("/safe", requireLocalSessionAuth, (_req, res) => {
    res.json({ ok: true });
  });
  app.post("/mutate", requireLocalSessionAuth, (_req, res) => {
    res.json({ ok: true });
  });
  app.put("/mutate-put", requireLocalSessionAuth, (_req, res) => {
    res.json({ ok: true });
  });
  app.delete("/mutate-del", requireLocalSessionAuth, (_req, res) => {
    res.json({ ok: true });
  });
  app.patch("/mutate-patch", requireLocalSessionAuth, (_req, res) => {
    res.json({ ok: true });
  });

  app.use(errorHandler);
  return app;
}

describe("requireLocalSessionAuth middleware (CSRF)", () => {
  let app: Express;

  beforeEach(() => {
    setLocalSessionTokenForTesting(TOKEN);
    app = buildApp();
  });

  afterEach(() => {
    setLocalSessionTokenForTesting(VITEST_DEFAULT_LOCAL_SESSION_TOKEN);
    ensureLocalSessionToken();
  });

  // ── GET (safe) ──

  it("GET with bearer passes", async () => {
    const res = await request(app).get("/safe").set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
  });

  it("GET with localhost Origin (no bearer) passes", async () => {
    const res = await request(app).get("/safe").set("Origin", "http://localhost:5173");
    expect(res.status).toBe(200);
  });

  it("GET with localhost Referer (no bearer) passes", async () => {
    const res = await request(app).get("/safe").set("Referer", "http://127.0.0.1:3100/app");
    expect(res.status).toBe(200);
  });

  it("GET with no credentials is rejected", async () => {
    const res = await request(app).get("/safe");
    expect(res.status).toBe(403);
  });

  // ── POST (mutating) ──

  it("POST with bearer passes", async () => {
    const res = await request(app)
      .post("/mutate")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ data: 1 });
    expect(res.status).toBe(200);
  });

  it("POST with localhost Origin but no bearer is rejected (CSRF)", async () => {
    const res = await request(app)
      .post("/mutate")
      .set("Origin", "http://localhost:5173")
      .send({ data: 1 });
    expect(res.status).toBe(403);
  });

  it("POST with localhost Referer but no bearer is rejected (CSRF)", async () => {
    const res = await request(app)
      .post("/mutate")
      .set("Referer", "http://127.0.0.1:3100/page")
      .send({ data: 1 });
    expect(res.status).toBe(403);
  });

  it("POST with wrong bearer is rejected even with localhost Origin", async () => {
    const res = await request(app)
      .post("/mutate")
      .set("Authorization", "Bearer wrong")
      .set("Origin", "http://localhost:5173")
      .send({ data: 1 });
    expect(res.status).toBe(403);
  });

  // ── PUT (mutating) ──

  it("PUT with bearer passes", async () => {
    const res = await request(app)
      .put("/mutate-put")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ data: 1 });
    expect(res.status).toBe(200);
  });

  it("PUT with only localhost Origin is rejected (CSRF)", async () => {
    const res = await request(app)
      .put("/mutate-put")
      .set("Origin", "http://localhost:3000")
      .send({ data: 1 });
    expect(res.status).toBe(403);
  });

  // ── DELETE (mutating) ──

  it("DELETE with bearer passes", async () => {
    const res = await request(app).delete("/mutate-del").set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
  });

  it("DELETE with only localhost Referer is rejected (CSRF)", async () => {
    const res = await request(app)
      .delete("/mutate-del")
      .set("Referer", "http://localhost:5173/app");
    expect(res.status).toBe(403);
  });

  // ── PATCH (mutating) ──

  it("PATCH with bearer passes", async () => {
    const res = await request(app)
      .patch("/mutate-patch")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ data: 1 });
    expect(res.status).toBe(200);
  });

  it("PATCH with only localhost Origin is rejected (CSRF)", async () => {
    const res = await request(app)
      .patch("/mutate-patch")
      .set("Origin", "http://localhost:3000")
      .send({ data: 1 });
    expect(res.status).toBe(403);
  });
});
