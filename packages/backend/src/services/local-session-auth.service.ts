/**
 * Per-process session secret for local API routes that must not be callable by
 * arbitrary same-machine clients without browser-like Origin/Referer or the bearer token.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

let sessionToken: string | null = null;

/**
 * Fixed token when running tests (Vitest or NODE_ENV=test).
 * Exported so test files can reset shared session state between suites.
 */
export const VITEST_DEFAULT_LOCAL_SESSION_TOKEN = "vitest-local-session-auth-token";

function isTestProcess(): boolean {
  if (process.env.NODE_ENV === "test") return true;
  const v = process.env.VITEST;
  return v !== undefined && v !== "" && v !== "0" && v !== "false";
}

function hashToken(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function tokensEqual(a: string, b: string): boolean {
  const ah = hashToken(a);
  const bh = hashToken(b);
  if (ah.length !== bh.length) return false;
  return timingSafeEqual(ah, bh);
}

/** Idempotent: generates a random token in production/dev, fixed token in Vitest. */
export function ensureLocalSessionToken(): void {
  if (sessionToken !== null) return;
  if (isTestProcess()) {
    sessionToken = VITEST_DEFAULT_LOCAL_SESSION_TOKEN;
    return;
  }
  sessionToken = randomBytes(32).toString("base64url");
}

export function getLocalSessionToken(): string {
  ensureLocalSessionToken();
  return sessionToken as string;
}

/** Reset or set token (tests). Pass null to clear so ensureLocalSessionToken runs again. */
export function setLocalSessionTokenForTesting(token: string | null): void {
  sessionToken = token;
}

export function originIsTrustedLocalhost(origin: string | undefined): boolean {
  return Boolean(origin && LOCALHOST_ORIGIN_RE.test(origin));
}

export function refererIsTrustedLocalhost(referer: string | undefined): boolean {
  if (!referer) return false;
  try {
    const { hostname } = new URL(referer);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

/**
 * Returns true when the Authorization header carries a valid Bearer session token.
 */
export function requestHasValidBearerToken(authorization: string | undefined): boolean {
  const auth = authorization;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (
      token.length > 0 &&
      (tokensEqual(token, getLocalSessionToken()) ||
        (isTestProcess() && tokensEqual(token, VITEST_DEFAULT_LOCAL_SESSION_TOKEN)))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Accepts a valid Bearer token **or** a trusted localhost Origin / Referer.
 * Suitable for read-only (GET/HEAD/OPTIONS) requests where CSRF risk is low.
 */
export function requestHasLocalSessionCredential(
  authorization: string | undefined,
  origin: string | undefined,
  referer: string | undefined
): boolean {
  if (requestHasValidBearerToken(authorization)) return true;
  if (originIsTrustedLocalhost(origin)) return true;
  if (refererIsTrustedLocalhost(referer)) return true;
  return false;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

/**
 * For the given HTTP method, decide whether the request is authenticated.
 *
 * - **Mutating methods** (POST, PUT, DELETE, PATCH): require a valid Bearer
 *   token. A localhost Origin/Referer alone is not sufficient because another
 *   app on localhost could forge cross-site requests that the browser would
 *   send with a matching Origin header.
 * - **Safe methods** (GET, HEAD, OPTIONS): accept Bearer **or** localhost
 *   Origin/Referer (backward-compatible).
 */
export function requestIsAuthenticated(
  method: string,
  authorization: string | undefined,
  origin: string | undefined,
  referer: string | undefined
): boolean {
  if (MUTATING_METHODS.has(method.toUpperCase())) {
    return requestHasValidBearerToken(authorization);
  }
  return requestHasLocalSessionCredential(authorization, origin, referer);
}
