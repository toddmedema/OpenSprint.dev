/**
 * WorktreeRegistry — tracks worktree state and short-lived leases to prevent
 * concurrent cleanup/reuse races across phases.
 *
 * State model: created -> ready -> in_use -> validating -> repairing -> retired
 * Cleanup/prune only permitted for retired or lease-expired states.
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
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_LEASE_TTL_MS = 5 * 60_000; // 5 minutes

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
      leaseOwner: null,
      leaseExpiresAt: null,
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

  acquireLease(
    taskId: string,
    owner: string,
    ttlMs: number = DEFAULT_LEASE_TTL_MS
  ): boolean {
    const entry = this.entries.get(taskId);
    if (!entry) return false;

    if (entry.leaseOwner && entry.leaseExpiresAt && entry.leaseExpiresAt > Date.now()) {
      if (entry.leaseOwner !== owner) {
        log.warn("Lease conflict: worktree already leased", {
          taskId,
          currentOwner: entry.leaseOwner,
          requestedOwner: owner,
          expiresAt: new Date(entry.leaseExpiresAt).toISOString(),
        });
        return false;
      }
    }

    entry.leaseOwner = owner;
    entry.leaseExpiresAt = Date.now() + ttlMs;
    entry.updatedAt = Date.now();
    return true;
  }

  releaseLease(taskId: string, owner: string): boolean {
    const entry = this.entries.get(taskId);
    if (!entry) return false;

    if (entry.leaseOwner && entry.leaseOwner !== owner) {
      log.warn("Cannot release lease: owner mismatch", {
        taskId,
        currentOwner: entry.leaseOwner,
        requestedOwner: owner,
      });
      return false;
    }

    entry.leaseOwner = null;
    entry.leaseExpiresAt = null;
    entry.updatedAt = Date.now();
    return true;
  }

  isLeaseValid(taskId: string): boolean {
    const entry = this.entries.get(taskId);
    if (!entry || !entry.leaseOwner || !entry.leaseExpiresAt) return false;
    return entry.leaseExpiresAt > Date.now();
  }

  isLeaseExpired(taskId: string): boolean {
    const entry = this.entries.get(taskId);
    if (!entry || !entry.leaseExpiresAt) return true;
    return entry.leaseExpiresAt <= Date.now();
  }

  canCleanup(taskId: string): boolean {
    const entry = this.entries.get(taskId);
    if (!entry) return true;
    if (entry.state === "retired") return true;
    if (this.isLeaseExpired(taskId) && entry.state !== "in_use") return true;
    return false;
  }

  retire(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (!entry) return;
    entry.state = "retired";
    entry.leaseOwner = null;
    entry.leaseExpiresAt = null;
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

  listStaleLeases(maxAgeMs: number = DEFAULT_LEASE_TTL_MS): WorktreeEntry[] {
    const cutoff = Date.now() - maxAgeMs;
    return [...this.entries.values()].filter(
      (e) => e.leaseExpiresAt !== null && e.leaseExpiresAt < cutoff
    );
  }
}

export const worktreeRegistry = new WorktreeRegistry();
