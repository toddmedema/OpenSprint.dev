/**
 * WorktreeRegistry — tracks worktree state to prevent concurrent
 * cleanup/reuse races across phases.
 *
 * State model: created -> ready -> in_use -> validating -> repairing -> retired
 * Cleanup/prune only permitted for retired entries or entries that do not exist.
 *
 * Lease / TTL logic is NOT in this registry. The DB-backed
 * WorktreeLeaseService is the single durable source of truth for lease
 * expiry.  This registry is an in-memory state machine only.
 */

import { createLogger } from "../utils/logger.js";

const log = createLogger("worktree-registry");

export type WorktreeState =
  | "created"
  | "ready"
  | "in_use"
  | "validating"
  | "repairing"
  | "retired";

const VALID_TRANSITIONS: Record<WorktreeState, WorktreeState[]> = {
  created: ["ready", "retired"],
  ready: ["in_use", "validating", "retired"],
  in_use: ["validating", "ready", "retired"],
  validating: ["ready", "repairing", "retired"],
  repairing: ["ready", "retired"],
  retired: [],
};

export interface WorktreeEntry {
  taskId: string;
  worktreePath: string;
  branchName?: string;
  state: WorktreeState;
  createdAt: number;
  updatedAt: number;
}

export class WorktreeRegistry {
  private entries = new Map<string, WorktreeEntry>();

  register(
    taskId: string,
    worktreePath: string,
    branchName?: string
  ): WorktreeEntry {
    const now = Date.now();
    const entry: WorktreeEntry = {
      taskId,
      worktreePath,
      branchName,
      state: "created",
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(taskId, entry);
    return entry;
  }

  get(taskId: string): WorktreeEntry | undefined {
    return this.entries.get(taskId);
  }

  transition(taskId: string, to: WorktreeState): boolean {
    const entry = this.entries.get(taskId);
    if (!entry) {
      log.warn("Cannot transition unknown worktree", { taskId, to });
      return false;
    }

    const allowed = VALID_TRANSITIONS[entry.state];
    if (!allowed.includes(to)) {
      log.warn("Invalid worktree state transition", {
        taskId,
        from: entry.state,
        to,
      });
      return false;
    }

    entry.state = to;
    entry.updatedAt = Date.now();
    return true;
  }

  canCleanup(taskId: string): boolean {
    const entry = this.entries.get(taskId);
    if (!entry) return true;
    if (entry.state === "retired") return true;
    return false;
  }

  retire(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (!entry) return;
    entry.state = "retired";
    entry.updatedAt = Date.now();
  }

  remove(taskId: string): void {
    this.entries.delete(taskId);
  }

  listAll(): WorktreeEntry[] {
    return [...this.entries.values()];
  }

  listByState(state: WorktreeState): WorktreeEntry[] {
    return [...this.entries.values()].filter((e) => e.state === state);
  }
}

export const worktreeRegistry = new WorktreeRegistry();
