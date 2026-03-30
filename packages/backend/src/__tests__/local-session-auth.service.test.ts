import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setLocalSessionTokenForTesting,
  ensureLocalSessionToken,
  VITEST_DEFAULT_LOCAL_SESSION_TOKEN,
  originIsTrustedLocalhost,
  refererIsTrustedLocalhost,
  requestHasLocalSessionCredential,
  requestHasValidBearerToken,
  requestIsAuthenticated,
} from "../services/local-session-auth.service.js";

const VALID_TOKEN = "unit-test-session-token";
const BEARER = `Bearer ${VALID_TOKEN}`;
const LOCALHOST_ORIGIN = "http://localhost:3000";
const LOCALHOST_REFERER = "http://127.0.0.1:5173/page";

describe("local-session-auth.service", () => {
  beforeEach(() => {
    setLocalSessionTokenForTesting(VALID_TOKEN);
  });

  afterEach(() => {
    setLocalSessionTokenForTesting(VITEST_DEFAULT_LOCAL_SESSION_TOKEN);
    ensureLocalSessionToken();
  });

  // ── originIsTrustedLocalhost ──

  it("originIsTrustedLocalhost accepts localhost and 127.0.0.1 with optional port", () => {
    expect(originIsTrustedLocalhost("http://localhost:5173")).toBe(true);
    expect(originIsTrustedLocalhost("http://127.0.0.1:3100")).toBe(true);
    expect(originIsTrustedLocalhost("https://localhost")).toBe(true);
    expect(originIsTrustedLocalhost("http://[::1]:8080")).toBe(true);
    expect(originIsTrustedLocalhost("http://evil.com")).toBe(false);
    expect(originIsTrustedLocalhost(undefined)).toBe(false);
  });

  // ── refererIsTrustedLocalhost ──

  it("refererIsTrustedLocalhost parses URL host correctly", () => {
    expect(refererIsTrustedLocalhost("http://localhost:5173/app")).toBe(true);
    expect(refererIsTrustedLocalhost("http://127.0.0.1:3100/")).toBe(true);
    expect(refererIsTrustedLocalhost("https://evil.com/localhost")).toBe(false);
  });

  // ── requestHasValidBearerToken ──

  it("requestHasValidBearerToken accepts valid bearer", () => {
    expect(requestHasValidBearerToken(BEARER)).toBe(true);
  });

  it("requestHasValidBearerToken rejects wrong token", () => {
    expect(requestHasValidBearerToken("Bearer wrong-token")).toBe(false);
  });

  it("requestHasValidBearerToken rejects missing/empty auth", () => {
    expect(requestHasValidBearerToken(undefined)).toBe(false);
    expect(requestHasValidBearerToken("")).toBe(false);
    expect(requestHasValidBearerToken("Bearer ")).toBe(false);
  });

  // ── requestHasLocalSessionCredential (backward compat) ──

  it("requestHasLocalSessionCredential accepts matching bearer", () => {
    expect(requestHasLocalSessionCredential(BEARER, undefined, undefined)).toBe(true);
    expect(requestHasLocalSessionCredential("Bearer wrong", undefined, undefined)).toBe(false);
  });

  it("requestHasLocalSessionCredential accepts trusted Origin or Referer", () => {
    expect(requestHasLocalSessionCredential(undefined, LOCALHOST_ORIGIN, undefined)).toBe(true);
    expect(requestHasLocalSessionCredential(undefined, undefined, LOCALHOST_REFERER)).toBe(true);
    expect(requestHasLocalSessionCredential(undefined, undefined, undefined)).toBe(false);
  });

  // ── requestIsAuthenticated (method-aware CSRF protection) ──

  describe("requestIsAuthenticated", () => {
    const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];
    const MUTATING_METHODS = ["POST", "PUT", "DELETE", "PATCH"];

    describe("safe methods (GET/HEAD/OPTIONS)", () => {
      for (const method of SAFE_METHODS) {
        it(`${method} — accepts bearer token`, () => {
          expect(requestIsAuthenticated(method, BEARER, undefined, undefined)).toBe(true);
        });

        it(`${method} — accepts localhost Origin without bearer`, () => {
          expect(requestIsAuthenticated(method, undefined, LOCALHOST_ORIGIN, undefined)).toBe(true);
        });

        it(`${method} — accepts localhost Referer without bearer`, () => {
          expect(requestIsAuthenticated(method, undefined, undefined, LOCALHOST_REFERER)).toBe(
            true
          );
        });

        it(`${method} — rejects when no credentials at all`, () => {
          expect(requestIsAuthenticated(method, undefined, undefined, undefined)).toBe(false);
        });
      }
    });

    describe("mutating methods (POST/PUT/DELETE/PATCH)", () => {
      for (const method of MUTATING_METHODS) {
        it(`${method} — accepts valid bearer token`, () => {
          expect(requestIsAuthenticated(method, BEARER, undefined, undefined)).toBe(true);
        });

        it(`${method} — accepts bearer even with localhost origin`, () => {
          expect(requestIsAuthenticated(method, BEARER, LOCALHOST_ORIGIN, undefined)).toBe(true);
        });

        it(`${method} — rejects localhost Origin without bearer (CSRF protection)`, () => {
          expect(requestIsAuthenticated(method, undefined, LOCALHOST_ORIGIN, undefined)).toBe(
            false
          );
        });

        it(`${method} — rejects localhost Referer without bearer (CSRF protection)`, () => {
          expect(requestIsAuthenticated(method, undefined, undefined, LOCALHOST_REFERER)).toBe(
            false
          );
        });

        it(`${method} — rejects wrong bearer even with localhost origin`, () => {
          expect(requestIsAuthenticated(method, "Bearer wrong", LOCALHOST_ORIGIN, undefined)).toBe(
            false
          );
        });

        it(`${method} — rejects no credentials`, () => {
          expect(requestIsAuthenticated(method, undefined, undefined, undefined)).toBe(false);
        });
      }
    });

    it("is case-insensitive for method names", () => {
      expect(requestIsAuthenticated("post", BEARER, undefined, undefined)).toBe(true);
      expect(requestIsAuthenticated("post", undefined, LOCALHOST_ORIGIN, undefined)).toBe(false);
      expect(requestIsAuthenticated("get", undefined, LOCALHOST_ORIGIN, undefined)).toBe(true);
    });
  });
});
