#!/usr/bin/env npx tsx
/**
 * Ensures the database has the OpenSprint schema (tables and indexes).
 * Reads databaseUrl from ~/.opensprint/global-settings.json and runs the backend schema.
 * Supports both SQLite (default) and PostgreSQL. Idempotent; safe to run multiple times.
 *
 * Usage: npx tsx scripts/ensure-db-schema.ts
 */

import { getDatabaseUrl } from "../packages/backend/src/services/global-settings.service.js";
import { initAppDb } from "../packages/backend/src/db/app-db.js";

async function main(): Promise<void> {
  const databaseUrl = await getDatabaseUrl();
  const appDb = await initAppDb(databaseUrl);
  try {
    await appDb.getClient();
    console.log("Database schema applied.");
  } finally {
    await appDb.close();
  }
}

main().catch((err) => {
  console.error("Failed to apply database schema:", err);
  process.exit(1);
});
