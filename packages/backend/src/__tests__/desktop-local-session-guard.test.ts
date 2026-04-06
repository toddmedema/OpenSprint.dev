import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { allowDesktopLocalSessionScriptRequest } from "../desktop-local-session-guard.js";

function req(headers: Record<string, string | string[] | undefined>): Request {
  return { headers } as Request;
}

describe("allowDesktopLocalSessionScriptRequest", () => {
  it("allows when Sec-Fetch-Site is absent (Node, Electron main, supertest)", () => {
    expect(allowDesktopLocalSessionScriptRequest(req({}))).toBe(true);
  });

  it("allows same-origin and none", () => {
    expect(allowDesktopLocalSessionScriptRequest(req({ "sec-fetch-site": "same-origin" }))).toBe(
      true
    );
    expect(allowDesktopLocalSessionScriptRequest(req({ "sec-fetch-site": "none" }))).toBe(true);
  });

  it("rejects cross-site and same-site browser requests", () => {
    expect(allowDesktopLocalSessionScriptRequest(req({ "sec-fetch-site": "cross-site" }))).toBe(
      false
    );
    expect(allowDesktopLocalSessionScriptRequest(req({ "sec-fetch-site": "same-site" }))).toBe(
      false
    );
  });

  it("treats array header values like the first element", () => {
    expect(
      allowDesktopLocalSessionScriptRequest(req({ "sec-fetch-site": ["cross-site"] }))
    ).toBe(false);
  });
});
