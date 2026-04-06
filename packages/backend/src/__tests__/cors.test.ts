import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request, { type Test } from "supertest";
import express, { type ErrorRequestHandler } from "express";
import { localhostCors } from "../middleware/cors.js";
import {
  ensureLocalSessionToken,
  setLocalSessionTokenForTesting,
  VITEST_DEFAULT_LOCAL_SESSION_TOKEN,
} from "../services/local-session-auth.service.js";

/**
 * Timeout + one retry on supertest "socket hang up" (same flake class as env-route tests).
 * Full `npm run test` runs enough suites in parallel that OPTIONS occasionally drops.
 */
async function requestWithHangupRetry(build: () => Test) {
  const doRequest = () => build().timeout(10_000);
  try {
    return await doRequest();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/socket hang up/i.test(msg)) {
      return await doRequest();
    }
    throw err;
  }
}

function createTestApp() {
  const app = express();
  app.use(localhostCors);
  app.get("/test", (_req, res) => res.json({ ok: true }));
  // Without this, `cors` may forward `next(err)` into Express default handling, which can vary by
  // version/load and merge-gate runs have observed intermittent 204 on disallowed preflight.
  const onError: ErrorRequestHandler = (_err, _req, res, _next) => {
    res.status(500).end();
  };
  app.use(onError);
  return app;
}

describe("localhostCors", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    // Other suites use `vi.stubGlobal("fetch", …)`; supertest/undici may route through
    // `globalThis.fetch` in some Node versions — a stale mock can yield bogus statuses (merge-gate flake).
    vi.unstubAllGlobals();
    setLocalSessionTokenForTesting(VITEST_DEFAULT_LOCAL_SESSION_TOKEN);
    ensureLocalSessionToken();
    app = createTestApp();
  });

  afterEach(() => {
    setLocalSessionTokenForTesting(VITEST_DEFAULT_LOCAL_SESSION_TOKEN);
    ensureLocalSessionToken();
  });

  it("allows requests with no Origin header", async () => {
    const res = await requestWithHangupRetry(() => request(app).get("/test"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("allows http://localhost:5173", async () => {
    const res = await requestWithHangupRetry(() =>
      request(app).get("/test").set("Origin", "http://localhost:5173")
    );
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("allows http://127.0.0.1:3100", async () => {
    const res = await requestWithHangupRetry(() =>
      request(app).get("/test").set("Origin", "http://127.0.0.1:3100")
    );
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3100");
  });

  it("allows http://localhost (no port)", async () => {
    const res = await requestWithHangupRetry(() =>
      request(app).get("/test").set("Origin", "http://localhost")
    );
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost");
  });

  it("allows http://127.0.0.1 (no port)", async () => {
    const res = await requestWithHangupRetry(() =>
      request(app).get("/test").set("Origin", "http://127.0.0.1")
    );
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1");
  });

  it("blocks https://evil.com", async () => {
    const res = await requestWithHangupRetry(() =>
      request(app).get("/test").set("Origin", "https://evil.com")
    );
    expect(res.status).toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("blocks https://localhost.evil.com", async () => {
    const res = await requestWithHangupRetry(() =>
      request(app).get("/test").set("Origin", "https://localhost.evil.com")
    );
    expect(res.status).toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("blocks http://192.168.1.1:3100", async () => {
    const res = await requestWithHangupRetry(() =>
      request(app).get("/test").set("Origin", "http://192.168.1.1:3100")
    );
    expect(res.status).toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("responds to preflight OPTIONS with correct headers for allowed origin", async () => {
    const res = await requestWithHangupRetry(() =>
      request(app)
        .options("/test")
        .set("Origin", "http://localhost:5173")
        .set("Access-Control-Request-Method", "GET")
    );
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("rejects preflight OPTIONS for disallowed origin", async () => {
    const res = await requestWithHangupRetry(() =>
      request(app)
        .options("/test")
        .set("Origin", "https://attacker.io")
        .set("Access-Control-Request-Method", "GET")
    );
    expect(res.status).toBe(500);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
