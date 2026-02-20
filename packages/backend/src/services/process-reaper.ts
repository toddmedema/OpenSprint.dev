import { execSync } from "child_process";
import { createLogger } from "../utils/logger.js";

const log = createLogger("reaper");
const REAP_INTERVAL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;

const ORPHAN_CMD_SIGNATURES = ["vitest"];
const ORPHAN_CLAUDE_SIGNATURES = ["claude", "--print"];

/**
 * Parse `ps -eo pid,ppid,command` output into structured records.
 * Using the full `command` field (not `comm`) avoids macOS path-matching
 * issues where `comm` shows the full binary path (e.g. /Users/x/.local/bin/bd)
 * instead of just the base name.
 */
export function parseOrphanedProcesses(
  psOutput: string,
  ownPid: number
): Array<{ pid: number; command: string }> {
  const results: Array<{ pid: number; command: string }> = [];
  for (const line of psOutput.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Format: "  PID  PPID COMMAND..."  — first two tokens are numbers
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = parseInt(match[1], 10);
    const ppid = parseInt(match[2], 10);
    const command = match[3];
    if (ppid !== 1 || pid === ownPid) continue;
    results.push({ pid, command });
  }
  return results;
}

/**
 * Finds and kills orphaned worker processes (ppid=1) that were abandoned when
 * their parent was killed. Targets vitest workers and leaked bd daemon
 * processes, which can accumulate hundreds of instances and consume tens of GB.
 *
 * Uses `ps -eo pid,ppid,command` (full command line) instead of `comm` (executable
 * basename) because macOS `comm` shows the full binary path, breaking exact-match
 * filters like `$3 == "bd"`.
 */
function reapOrphanedWorkers(): void {
  if (process.platform === "win32") return;

  try {
    const output = execSync("ps -eo pid,ppid,command 2>/dev/null", {
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();

    if (!output) return;

    const orphans = parseOrphanedProcesses(output, process.pid);
    let killed = 0;

    for (const { pid, command } of orphans) {
      if (ORPHAN_CMD_SIGNATURES.some((sig) => command.includes(sig))) {
        try {
          process.kill(pid, "SIGKILL");
          killed++;
        } catch {
          /* process already exited or no permission */
        }
      }
    }

    if (killed > 0) {
      log.info("Killed orphaned workers", { killed });
    }
  } catch {
    /* ps not available or timed out — skip silently */
  }
}

/**
 * Kills orphaned claude CLI processes (ppid=1) from previous backend runs.
 * These accumulate when the backend restarts (e.g. tsx watch) and the parent
 * dies before killing spawned children.
 */
function reapOrphanedClaudeProcesses(): void {
  if (process.platform === "win32") return;

  try {
    const output = execSync("ps -eo pid,ppid,command 2>/dev/null", {
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();

    if (!output) return;

    const orphans = parseOrphanedProcesses(output, process.pid);
    let killed = 0;

    for (const { pid, command } of orphans) {
      if (ORPHAN_CLAUDE_SIGNATURES.every((sig) => command.includes(sig))) {
        try {
          process.kill(pid, "SIGKILL");
          killed++;
        } catch {
          /* process already exited or no permission */
        }
      }
    }

    if (killed > 0) {
      log.info("Killed orphaned claude processes", { killed });
    }
  } catch {
    /* ps not available or timed out — skip silently */
  }
}

export function startProcessReaper(): void {
  if (timer) return;
  reapOrphanedWorkers();
  reapOrphanedClaudeProcesses();
  timer = setInterval(() => {
    reapOrphanedWorkers();
    reapOrphanedClaudeProcesses();
  }, REAP_INTERVAL_MS);
  timer.unref();
}

export function stopProcessReaper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
