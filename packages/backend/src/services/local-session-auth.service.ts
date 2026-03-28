/**
 * Per-process session secret for local API routes that must not be callable by
 * arbitrary same-machine clients without browser-like Origin/Referer or the bearer token.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const LOCALHOST_ORIGIN_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

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

export function requestHasLocalSessionCredential(
  authorization: string | undefined,
  origin: string | undefined,
  referer: string | undefined
): boolean {
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
  if (originIsTrustedLocalhost(origin)) return true;
  if (refererIsTrustedLocalhost(referer)) return true;
  return false;
}
