import { describe, it, expect, beforeEach } from "vitest";
import { TokenEncryptionService } from "../services/token-encryption.service.js";

describe("TokenEncryptionService", () => {
  let svc: TokenEncryptionService;

  beforeEach(() => {
    svc = new TokenEncryptionService();
  });

  it("round-trips: encrypt then decrypt returns original plaintext", () => {
    const original = "xoxb-my-secret-token-12345";
    const encrypted = svc.encryptToken(original);
    expect(svc.decryptToken(encrypted)).toBe(original);
  });

  it("handles empty string", () => {
    const encrypted = svc.encryptToken("");
    expect(svc.decryptToken(encrypted)).toBe("");
  });

  it("handles unicode content", () => {
    const original = "token-with-émojis-🔑-and-日本語";
    const encrypted = svc.encryptToken(original);
    expect(svc.decryptToken(encrypted)).toBe(original);
  });

  it("produces different ciphertexts for different plaintexts", () => {
    const enc1 = svc.encryptToken("token-a");
    const enc2 = svc.encryptToken("token-b");
    expect(enc1).not.toBe(enc2);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const enc1 = svc.encryptToken("same-token");
    const enc2 = svc.encryptToken("same-token");
    expect(enc1).not.toBe(enc2);
    expect(svc.decryptToken(enc1)).toBe("same-token");
    expect(svc.decryptToken(enc2)).toBe("same-token");
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = svc.encryptToken("my-secret");
    const buf = Buffer.from(encrypted, "base64");
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString("base64");

    expect(() => svc.decryptToken(tampered)).toThrow();
  });

  it("throws on truncated payload", () => {
    expect(() => svc.decryptToken("dG9vLXNob3J0")).toThrow("payload too short");
  });

  it("respects INTEGRATION_ENCRYPTION_KEY env var", () => {
    const key = Buffer.alloc(32, 0xab).toString("base64");
    const original = process.env.INTEGRATION_ENCRYPTION_KEY;
    try {
      process.env.INTEGRATION_ENCRYPTION_KEY = key;
      const envSvc = new TokenEncryptionService();
      const encrypted = envSvc.encryptToken("env-test");
      expect(envSvc.decryptToken(encrypted)).toBe("env-test");

      // A different key should fail to decrypt
      const otherKey = Buffer.alloc(32, 0xcd).toString("base64");
      process.env.INTEGRATION_ENCRYPTION_KEY = otherKey;
      const otherSvc = new TokenEncryptionService();
      expect(() => otherSvc.decryptToken(encrypted)).toThrow();
    } finally {
      if (original === undefined) {
        delete process.env.INTEGRATION_ENCRYPTION_KEY;
      } else {
        process.env.INTEGRATION_ENCRYPTION_KEY = original;
      }
    }
  });

  it("rejects INTEGRATION_ENCRYPTION_KEY with wrong length", () => {
    const original = process.env.INTEGRATION_ENCRYPTION_KEY;
    try {
      process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
      expect(() => new TokenEncryptionService()).toThrow("must decode to 32 bytes");
    } finally {
      if (original === undefined) {
        delete process.env.INTEGRATION_ENCRYPTION_KEY;
      } else {
        process.env.INTEGRATION_ENCRYPTION_KEY = original;
      }
    }
  });
});
