#!/usr/bin/env npx tsx
/**
 * Ensures the Postgres database has the OpenSprint schema (tables and indexes).
 * Reads databaseUrl from ~/.opensprint/global-settings.json and runs the backend schema.
 * Used by setup.sh so "npm run setup" fully initializes the DB. Idempotent; safe to run multiple times.
 *
 * Usage: npx tsx scripts/ensure-db-schema.ts
 */

import { getDatabaseUrl } from "../packages/backend/src/services/global-settings.service.js";
import { runSchema } from "../packages/backend/src/db/schema.js";
import { createPostgresDbClientFromUrl } from "../packages/backend/src/db/client.js";

async function main(): Promise<void> {
  const databaseUrl = await getDatabaseUrl();
  const { client, pool } = await createPostgresDbClientFromUrl(databaseUrl);
  try {
    await runSchema(client);
    console.log("Database schema applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Failed to apply database schema:", err);
  process.exit(1);
});
