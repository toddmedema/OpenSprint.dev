import type { Test } from "supertest";
import request from "supertest";
import { getLocalSessionToken } from "../services/local-session-auth.service.js";

/**
 * ## Local session auth for HTTP integration tests
 *
 * `createApp()` mounts `requireLocalSessionAuth` on `API_PREFIX` (`/api/v1`). Success
 * assertions against those routes must send `Authorization: Bearer <token>` matching
 * `getLocalSessionToken()` (Vitest uses `VITEST_DEFAULT_LOCAL_SESSION_TOKEN`).
 *
 * Without it, the gate responds **403** (`LOCAL_SESSION_AUTH_REQUIRED`). Merge-gate
 * fingerprints and failure summaries sometimes describe that class of failure as
 * “auth” alongside upstream **401** responses from integration providers (GitHub /
 * Todoist). Prefer fixing missing Bearer headers in tests rather than loosening
 * production auth.
 *
 * **Use `authedSupertest(app)` or `withLocalSessionAuth(request(app).get(...))`.**
 * For chained supertest APIs (e.g. `.query()`, `.send()`), start from
 * `withLocalSessionAuth(request(app).get(url).query(...))` so the header applies to
 * the final request.
 *
 * **Guard:** `local-session-createapp-test-convention.test.ts` fails CI if a file
 * imports `createApp` from `../app.js` and uses raw `request(app)` (except
 * `app.test.ts`, which intentionally covers unauthenticated API cases).
 *
 * **Merge gate parity:** deterministic test runs set `NODE_ENV=test`,
 * `OPENSPRINT_MERGE_GATE_TEST_MODE=1`, optional `OPENSPRINT_VITEST_RUN_ID`, and
 * `OPENSPRINT_VITEST_INTEGRATION_MAX_WORKERS` (see `merge-quality-gates.ts`). Reproduce
 * locally with the same env when debugging gate-only flakes:
 *
 * ```bash
 * OPENSPRINT_MERGE_GATE_TEST_MODE=1 OPENSPRINT_VITEST_RUN_ID=mergegate_local \\
 *   npm run test -w packages/backend
 * ```
 *
 * Router-only mini-apps that mount the same paths without `requireLocalSessionAuth`
 * should still attach Bearer in tests so behavior matches production when those
 * routers are mounted behind the real API gate.
 */

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
