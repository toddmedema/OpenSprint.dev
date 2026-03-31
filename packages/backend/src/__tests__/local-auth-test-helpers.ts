import type { Test } from "supertest";
import request from "supertest";
import { getLocalSessionToken } from "../services/local-session-auth.service.js";

/** Attach bearer token for Vitest (matches ensureLocalSessionToken test default). */
export function withLocalSessionAuth(req: Test): Test {
  return req.set("Authorization", `Bearer ${getLocalSessionToken()}`);
}

/**
 * `supertest(app)` returns a factory of HTTP verbs, not a `Test` — call `.get`/`.post` first,
 * then wrap with {@link withLocalSessionAuth}. Use this helper for full-app integration tests.
 */
export function authedSupertest(app: Parameters<typeof request>[0]) {
  const r = request(app);
  return {
    get: (url: string): Test => withLocalSessionAuth(r.get(url)),
    post: (url: string): Test => withLocalSessionAuth(r.post(url)),
    put: (url: string): Test => withLocalSessionAuth(r.put(url)),
    delete: (url: string): Test => withLocalSessionAuth(r.delete(url)),
    patch: (url: string): Test => withLocalSessionAuth(r.patch(url)),
  };
}
