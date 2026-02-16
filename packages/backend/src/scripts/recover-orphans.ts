#!/usr/bin/env node
/**
 * CLI: Recover orphaned tasks (in_progress + agent assignee but no active process).
 * Used by agent-chain.sh as a pre-flight check before picking a new task.
 * Also called by the orchestrator on startup.
 *
 * Usage: npx tsx src/scripts/recover-orphans.ts
 * Run from repo root (cwd = project repo with .beads).
 * Exits 0. Logs a warning for each recovered task.
 */

import path from "path";
import fs from "fs";
import { orphanRecoveryService } from "../services/orphan-recovery.service.js";

function findRepoRoot(start: string): string {
  let dir = path.resolve(start);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".beads"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return start;
}

const repoPath = findRepoRoot(process.cwd());

orphanRecoveryService
  .recoverOrphanedTasks(repoPath)
  .then(({ recovered }) => {
    if (recovered.length > 0) {
      console.warn(`[recover-orphans] Reset ${recovered.length} orphaned task(s) to open`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("[recover-orphans]", err.message);
    process.exit(1);
  });
