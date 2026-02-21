import path from "path";
import { open as fsOpen, stat as fsStat, readdir, readFile } from "fs/promises";
import { OPENSPRINT_PATHS } from "@opensprint/shared";
import type { TaskAssignment } from "./orchestrator.service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("crash-recovery");

/**
 * Crash recovery for the orchestrator (PRD §5.8).
 *
 * GUPP-style: work state is persisted in assignment.json before agent spawn.
 * On backend crash, recovery reads assignment.json and can re-spawn the agent.
 *
 * Recovery scenarios (handled at orchestrator startup):
 * 1. No active task — clear state, normal start
 * 2. Active task, PID alive — resume monitoring (output streaming, timeout), handle exit
 * 3. Active task, PID dead — revert/cleanup, comment bead, requeue task
 *
 * This service provides: findOrphanedAssignments (scan .opensprint/active/),
 * readOutputLogTail, readOutputLogFrom for output streaming during recovery.
 */
export class CrashRecoveryService {
  /**
   * Scan `.opensprint/active/` for assignment.json files.
   * Returns all assignments found (caller decides what to do with them).
   */
  async findOrphanedAssignments(
    repoPath: string
  ): Promise<Array<{ taskId: string; assignment: TaskAssignment }>> {
    const activeDir = path.join(repoPath, OPENSPRINT_PATHS.active);
    const orphaned: Array<{ taskId: string; assignment: TaskAssignment }> = [];

    try {
      const entries = await readdir(activeDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
        const assignmentPath = path.join(activeDir, entry.name, OPENSPRINT_PATHS.assignment);
        try {
          const raw = await readFile(assignmentPath, "utf-8");
          const assignment = JSON.parse(raw) as TaskAssignment;
          orphaned.push({ taskId: entry.name, assignment });
        } catch {
          // No assignment.json — skip
        }
      }
    } catch {
      // No active directory — nothing to recover
    }

    return orphaned;
  }

  /**
   * Read up to maxBytes from the end of an output log file.
   * Returns the data and the file offset after reading (for subsequent reads).
   */
  async readOutputLogTail(
    logPath: string,
    maxBytes: number
  ): Promise<{ data: string; offset: number }> {
    const s = await fsStat(logPath);
    if (s.size === 0) return { data: "", offset: 0 };
    const start = Math.max(0, s.size - maxBytes);
    const toRead = s.size - start;
    const fh = await fsOpen(logPath, "r");
    try {
      const buf = Buffer.alloc(toRead);
      const { bytesRead } = await fh.read(buf, 0, toRead, start);
      return { data: buf.subarray(0, bytesRead).toString(), offset: start + bytesRead };
    } finally {
      await fh.close();
    }
  }

  /** Read new bytes from the output log starting at the given offset. */
  async readOutputLogFrom(
    logPath: string,
    offset: number
  ): Promise<{ data: string; bytesRead: number }> {
    const s = await fsStat(logPath);
    if (s.size <= offset) return { data: "", bytesRead: 0 };
    const toRead = Math.min(s.size - offset, 256 * 1024);
    const fh = await fsOpen(logPath, "r");
    try {
      const buf = Buffer.alloc(toRead);
      const { bytesRead } = await fh.read(buf, 0, toRead, offset);
      return { data: buf.subarray(0, bytesRead).toString(), bytesRead };
    } finally {
      await fh.close();
    }
  }
}
