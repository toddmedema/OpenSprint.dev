#!/usr/bin/env npx tsx
/**
 * One-time script: delete orphaned open_questions rows whose project_id
 * references a project that no longer exists in the project index.
 *
 * Idempotent and safe to run multiple times.
 *
 * Usage: npx tsx scripts/delete-orphaned-open-questions.ts
 */

import { deleteOrphanedOpenQuestions } from "../packages/backend/src/services/delete-orphaned-open-questions.js";

async function main(): Promise<void> {
  const { deletedCount, deletedIds } = await deleteOrphanedOpenQuestions();

  if (deletedCount === 0) {
    console.log("No orphaned open_questions found.");
    return;
  }

  console.log(`Deleted ${deletedCount} orphaned open_questions row(s).`);
  for (const row of deletedIds) {
    console.log(`  - ${row.id} (project_id: ${row.project_id})`);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
