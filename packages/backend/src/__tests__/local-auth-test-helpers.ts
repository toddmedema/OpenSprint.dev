import type { Test } from "supertest";
import request from "supertest";
import { getLocalSessionToken } from "../services/local-session-auth.service.js";

/**
 * Attaches `Authorization: Bearer <vitest session token>` so requests pass
 * `requireLocalSessionAuth` on the real app (`createApp()`).
 */
export function withLocalSessionAuth(req: Test): Test {
  return req.set("Authorization", `Bearer ${getLocalSessionToken()}`);
}

/**
 * Supertest against **`createApp()`** (or any Express app that mounts
 * `requireLocalSessionAuth` on `API_PREFIX`). Prefer this over `request(app)` for
 * `/api/v1/...` assertions that expect success; raw `request(app)` hits the gate and
 * returns 403 without the header.
 *
 * Router-only mini-apps that omit `requireLocalSessionAuth` can still call
 * `withLocalSessionAuth` / `authedSupertest` so tests stay aligned when the same
 * router is mounted behind the real API auth gate (`app.ts`).
 */
export function authedSupertest(app: Parameters<typeof request>[0]) {
  const r = request(app);
  return {
    get: (url: string): Test => withLocalSessionAuth(r.get(url)),
    post: (url: string): Test => withLocalSessionAuth(r.post(url)),
    put: (url: string): Test => withLocalSessionAuth(r.put(url)),
    delete: (url: string): Test => withLocalSessionAuth(r.delete(url)),
    patch: (url: string): Test => withLocalSessionAuth(r.patch(url)),
    head: (url: string): Test => withLocalSessionAuth(r.head(url)),
  };
}
