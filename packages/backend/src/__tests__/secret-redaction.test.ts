import { describe, it, expect } from "vitest";
import {
  redactFailureDiagnosticDetail,
  redactRetryQualityGateDetail,
  redactSecretsForUserDisplay,
} from "../utils/secret-redaction.js";

describe("redactSecretsForUserDisplay", () => {
  it("redacts Anthropic sk-ant- keys", () => {
    const raw = "Error: key sk-ant-api03-fakeSecretKeySuffix1234567890 in env";
    const out = redactSecretsForUserDisplay(raw);
    expect(out).not.toMatch(/sk-ant-api03-fakeSecretKeySuffix1234567890/);
    expect(out).toContain("[REDACTED]");
  });

  it("redacts CURSOR_API_KEY= assignments", () => {
    const raw = "export CURSOR_API_KEY=supersecretvalue123";
    const out = redactSecretsForUserDisplay(raw);
    expect(out).not.toMatch(/supersecretvalue123/);
    expect(out).toMatch(/CURSOR_API_KEY=\[REDACTED\]/);
  });

  it("redacts Bearer JWT-style tokens", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const raw = `Request failed with Authorization: Bearer ${jwt}`;
    const out = redactSecretsForUserDisplay(raw);
    expect(out).not.toContain(jwt);
    expect(out).toMatch(/Authorization:\s*\[REDACTED\]/i);
  });

  it("redacts standalone JWT-like three-segment strings", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const out = redactSecretsForUserDisplay(`token was ${jwt} end`);
    expect(out).not.toContain(jwt);
    expect(out).toContain("[REDACTED_JWT]");
  });

  it("does not redact short Bearer prose", () => {
    const raw = "Use Bearer token in the header";
    expect(redactSecretsForUserDisplay(raw)).toBe(raw);
  });

  it("leaves ordinary TypeErrors readable", () => {
    const raw = "TypeError: Cannot read properties of undefined (reading 'map')";
    expect(redactSecretsForUserDisplay(raw)).toBe(raw);
  });

  it("redacts bare Bearer JWT when not in Authorization header", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const out = redactSecretsForUserDisplay(`failed: Bearer ${jwt}`);
    expect(out).not.toContain(jwt);
    expect(out).toMatch(/Bearer\s+\[REDACTED\]/);
  });

  it("redacts Authorization header values", () => {
    const raw = "curl -H 'Authorization: Bearer xyzverylongsecrettokenvalue1234567890'";
    const out = redactSecretsForUserDisplay(raw);
    expect(out).not.toMatch(/xyzverylongsecrettokenvalue1234567890/);
    expect(out).toMatch(/Authorization:\s*\[REDACTED\]/i);
  });

  it("is safe to apply twice (idempotent size)", () => {
    const raw = "k sk-ant-api03-abc123456789012345678901234567890";
    const once = redactSecretsForUserDisplay(raw);
    const twice = redactSecretsForUserDisplay(once);
    expect(twice).toBe(once);
  });
});

describe("redactFailureDiagnosticDetail", () => {
  it("redacts nested diagnostic strings", () => {
    const d = redactFailureDiagnosticDetail({
      command: "npm test",
      reason: "failed CURSOR_API_KEY=leak-here",
      outputSnippet: "stderr: sk-ant-api03-nestedleak98765432109876543210",
      worktreePath: "/tmp/wt",
      firstErrorLine: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhIjoiYiJ9.sigsigsig",
    });
    expect(d!.reason).not.toMatch(/leak-here/);
    expect(d!.outputSnippet).not.toMatch(/sk-ant-api03-nestedleak/);
    expect(d!.firstErrorLine).not.toMatch(/eyJhbGciOiJIUzI1NiI/);
    expect(d!.command).toBe("npm test");
  });
});

describe("redactRetryQualityGateDetail", () => {
  it("preserves extra fields while redacting known strings", () => {
    const out = redactRetryQualityGateDetail({
      category: "quality_gate",
      reason: "OPENAI_API_KEY=secret12345678901234567890",
      classificationReason: "matched sk-proj-abcdefghij0123456789ABCDEFGH",
    });
    expect(out!.category).toBe("quality_gate");
    expect(out!.reason).not.toMatch(/secret12345678901234567890/);
    expect(out!.classificationReason).not.toMatch(/sk-proj-abcdefghij0123456789ABCDEFGH/);
  });
});
