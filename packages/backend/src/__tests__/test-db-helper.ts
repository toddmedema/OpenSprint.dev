/**
 * Test helpers for database: DbClient mocks and Postgres client for integration tests.
 * Tests that need a real DB use createTestPostgresClient() or createPostgresDbClientFromUrl + runSchema.
 *
 * Uses TEST_DATABASE_URL if set, else reads from .vitest-postgres-url (written by global-setup
 * when using testcontainers). Falls back to localhost if neither.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import type { Pool } from "pg";
import type { DbClient } from "../db/client.js";
import {
  createPostgresDbClientFromUrl,
  runSchema,
} from "../db/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const URL_FILE = path.resolve(__dirname, "../../.vitest-postgres-url");
const DEFAULT_URL = "postgresql://opensprint:opensprint@localhost:5432/opensprint";

async function getTestDatabaseUrl(): Promise<string> {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }
  try {
    const url = await fs.readFile(URL_FILE, "utf-8");
    return url.trim();
  } catch {
    return DEFAULT_URL;
  }
}

/**
 * Create a Postgres DbClient for tests. Returns null if Postgres is unreachable.
 * Caller must call pool.end() in afterAll.
 */
export async function createTestPostgresClient(): Promise<{
  client: DbClient;
  pool: Pool;
} | null> {
  try {
    const url = await getTestDatabaseUrl();
    const result = await createPostgresDbClientFromUrl(url);
    await result.client.query("SELECT 1");
    await runSchema(result.client);
    return result;
  } catch {
    return null;
  }
}

/** Create a mock DbClient for tests that don't need real DB. */
export function createMockDbClient(overrides?: Partial<DbClient>): DbClient {
  const base: DbClient = {
    query: async () => [],
    queryOne: async () => undefined,
    execute: async () => 0,
    runInTransaction: async (fn) => fn(base),
  };
  return { ...base, ...overrides };
}
