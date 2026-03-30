/**
 * AES-256-GCM encrypt/decrypt for storing integration access tokens at rest.
 *
 * Key resolution order:
 *   1. INTEGRATION_ENCRYPTION_KEY env var (base64-encoded 32-byte key)
 *   2. Deterministic key derived from hostname + a per-install salt stored
 *      in ~/.opensprint/encryption-salt
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

function opensprintDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(home, ".opensprint");
}

function getOrCreateSalt(): string {
  const dir = opensprintDir();
  const saltPath = path.join(dir, "encryption-salt");
  try {
    return fs.readFileSync(saltPath, "utf-8").trim();
  } catch {
    fs.mkdirSync(dir, { recursive: true });
    const salt = randomBytes(32).toString("hex");
    fs.writeFileSync(saltPath, salt, { mode: 0o600 });
    return salt;
  }
}

function deriveKeyFromMachine(): Buffer {
  const salt = getOrCreateSalt();
  const seed = `${os.hostname()}:${salt}`;
  return createHash("sha256").update(seed).digest();
}

function resolveKey(): Buffer {
  const envKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (envKey) {
    const buf = Buffer.from(envKey, "base64");
    if (buf.length !== KEY_BYTES) {
      throw new Error(
        `INTEGRATION_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${buf.length}`
      );
    }
    return buf;
  }
  return deriveKeyFromMachine();
}

export class TokenEncryptionService {
  private key: Buffer;

  constructor() {
    this.key = resolveKey();
  }

  /**
   * Encrypt plaintext. Returns a base64 string encoding iv:authTag:ciphertext.
   */
  encryptToken(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const payload = Buffer.concat([iv, authTag, encrypted]);
    return payload.toString("base64");
  }

  /**
   * Decrypt a token produced by `encryptToken`. Throws on tampered data.
   */
  decryptToken(encoded: string): string {
    const payload = Buffer.from(encoded, "base64");

    if (payload.length < IV_BYTES + AUTH_TAG_BYTES) {
      throw new Error("Invalid encrypted token: payload too short");
    }

    const iv = payload.subarray(0, IV_BYTES);
    const authTag = payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = payload.subarray(IV_BYTES + AUTH_TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  }
}

export const tokenEncryption = new TokenEncryptionService();
