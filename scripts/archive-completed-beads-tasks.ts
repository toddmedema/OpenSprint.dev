/**
 * 1. Backs up only completed (closed) tasks to .beads/issues-backup.jsonl
 * 2. Deletes all completed tasks from beads (DB + issues.jsonl via export)
 *
 * Run from repo root: npx tsx scripts/archive-completed-beads-tasks.ts
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const REPO_ROOT = path.resolve(process.cwd());
const BEADS_DIR = path.join(REPO_ROOT, ".beads");
const ISSUES_JSONL = path.join(BEADS_DIR, "issues.jsonl");
const BACKUP_JSONL = path.join(BEADS_DIR, "issues-backup.jsonl");

function main() {
  if (!fs.existsSync(ISSUES_JSONL)) {
    console.error("Not found:", ISSUES_JSONL);
    process.exit(1);
  }

  const content = fs.readFileSync(ISSUES_JSONL, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());
  const closed: string[] = [];
  const backupLines: string[] = [];

  for (const line of lines) {
    try {
      const issue = JSON.parse(line) as { id?: string; status?: string };
      if (issue.status === "closed" && issue.id) {
        closed.push(issue.id);
        backupLines.push(line);
      }
    } catch {
      // skip malformed lines
    }
  }

  if (closed.length === 0) {
    console.log("No closed tasks to archive.");
    return;
  }

  console.log(`Found ${closed.length} closed task(s). Backing up to ${BACKUP_JSONL} ...`);
  fs.writeFileSync(BACKUP_JSONL, backupLines.join("\n") + "\n", "utf-8");

  console.log(`Deleting ${closed.length} closed task(s) from beads ...`);
  for (const id of closed) {
    try {
      execSync(`bd delete ${id} --force --json`, { cwd: REPO_ROOT, stdio: "pipe" });
    } catch (err) {
      console.warn(`bd delete ${id} failed:`, (err as Error).message);
    }
  }

  console.log("Exporting updated state to issues.jsonl ...");
  execSync(`bd export -o "${ISSUES_JSONL}"`, { cwd: REPO_ROOT, stdio: "inherit" });

  console.log("Done. Backup is at", BACKUP_JSONL);
}

main();
