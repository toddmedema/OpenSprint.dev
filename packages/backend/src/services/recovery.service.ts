/**
 * RecoveryService — unified recovery across all mechanisms.
 *
 * Consolidates 5 overlapping recovery paths into a single service:
 *   1. GUPP crash recovery (assignment.json scan)
 *   2. Orphaned in_progress tasks
 *   3. Stale heartbeat detection
 *   4. Stale git lock removal
 *   5. Slot vs task store reconciliation
 *
 * Called once on startup by the orchestrator and periodically by the watchdog.
 */

import fs from "fs/promises";
import path from "path";
import { AGENT_SUSPEND_GRACE_MS, HEARTBEAT_STALE_MS } from "@opensprint/shared";
import type { StoredTask } from "./task-store.service.js";
import { taskStore as taskStoreSingleton } from "./task-store.service.js";
import { BranchManager } from "./branch-manager.js";
import { CrashRecoveryService } from "./crash-recovery.service.js";
import { ProjectService } from "./project.service.js";
import { heartbeatService } from "./heartbeat.service.js";
import { eventLogService } from "./event-log.service.js";
import { worktreeCleanupIntentService } from "./worktree-cleanup-intent.service.js";
import type { RetryContext } from "./orchestrator-phase-context.js";
import { isProcessAlive, terminateProcessGroup } from "../utils/process-group.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("recovery");

const GIT_LOCK_STALE_MS = 10 * 60 * 1000; // 10 minutes
const STALE_INACTIVE_WORKTREE_MS = (() => {
  const rawValue = process.env.OPENSPRINT_STALE_INACTIVE_WORKTREE_MS;
  if (rawValue == null || rawValue.trim() === "") return 24 * 60 * 60 * 1000;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 24 * 60 * 60 * 1000;
})();
const SLOT_RECOVERY_GRACE_MS = (() => {
  const rawValue = process.env.OPENSPRINT_SLOT_RECOVERY_GRACE_MS;
  if (rawValue == null || rawValue.trim() === "") return 30_000;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30_000;
})();
const HEARTBEAT_WITHOUT_PID_MAX_AGE_MS = (() => {
  const rawValue = process.env.OPENSPRINT_HEARTBEAT_WITHOUT_PID_MAX_AGE_MS;
  if (rawValue == null || rawValue.trim() === "") return 15 * 60 * 1000;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 15 * 60 * 1000;
})();
const RECOVERABLE_HEARTBEAT_GAP_MAX_MS = (() => {
  const rawValue = process.env.OPENSPRINT_RECOVERABLE_HEARTBEAT_GAP_MAX_MS;
  if (rawValue == null || rawValue.trim() === "") return 15 * 60 * 1000;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 15 * 60 * 1000;
})();

export interface RecoveryResult {
  reattached: string[];
  requeued: string[];
  cleaned: string[];
}

export interface RecoveryHost {
  getSlottedTaskIds(projectId: string): string[];
  getActiveAgentIds(projectId: string): string[];
  /** Worktree keys held by active slots (task.id or epic_<epicId>). */
  getSlottedWorktreeKeys?(projectId: string): string[];
  /** Worktree paths held by active slots. */
  getSlottedWorktreePaths?(projectId: string): string[];
  /** Called to reattach a slot for a still-running agent (GUPP recovery) */
  reattachSlot?(
    projectId: string,
    repoPath: string,
    task: StoredTask,
    assignment: GuppAssignment
  ): Promise<boolean>;
  /** Called to resume a review-phase task after restart, rebuilding review/test coordination safely. */
  resumeReviewPhase?(
    projectId: string,
    repoPath: string,
    task: StoredTask,
    assignment: GuppAssignment,
    options: { pidAlive: boolean }
  ): Promise<boolean>;
  /** Called when a stale heartbeat still has a live process-group leader and an assignment to reattach from. */
  handleRecoverableHeartbeatGap?(
    projectId: string,
    repoPath: string,
    task: StoredTask,
    assignment: GuppAssignment
  ): Promise<boolean>;
  /** Called when an orphaned assignment already has a terminal result.json and should be completed instead of requeued. */
  handleCompletedAssignment?(
    projectId: string,
    repoPath: string,
    task: StoredTask,
    assignment: GuppAssignment
  ): Promise<boolean>;
  /** Called to remove a slot whose task no longer exists in task store */
  removeStaleSlot?(projectId: string, taskId: string, repoPath: string): Promise<void>;
}

export interface GuppAssignment {
  taskId: string;
  projectId: string;
  phase: "coding" | "review";
  branchName: string;
  /** Worktree key (task.id or epic_<epicId>). When present, recovery uses it for slot. */
  worktreeKey?: string;
  worktreePath: string;
  promptPath: string;
  agentConfig: unknown;
  attempt: number;
  retryContext?: RetryContext;
  createdAt: string;
  replayMetadata?: {
    baseCommitSha: string;
    behaviorVersionId?: string;
    templateVersionId?: string;
  };
}

export class RecoveryService {
  private taskStore = taskStoreSingleton;
  private branchManager = new BranchManager();
  private crashRecovery = new CrashRecoveryService();
  private projectService = new ProjectService();

  /**
   * Run full recovery pass. Safe to call multiple times (idempotent).
   * Startup mode includes GUPP (assignment reattachment); periodic mode skips it.
   */
  async runFullRecovery(
    projectId: string,
    repoPath: string,
    host: RecoveryHost,
    opts: { includeGupp?: boolean } = {}
  ): Promise<RecoveryResult> {
    const result: RecoveryResult = { reattached: [], requeued: [], cleaned: [] };

    // 1. GUPP crash recovery (startup only)
    if (
      opts.includeGupp &&
      (host.reattachSlot || host.resumeReviewPhase || host.handleCompletedAssignment)
    ) {
      const guppResult = await this.recoverFromAssignments(projectId, repoPath, host);
      result.reattached.push(...guppResult.reattached);
      result.requeued.push(...guppResult.requeued);
    }

    // Build exclude set: active agents + slotted tasks + just-reattached
    const excludeIds = new Set([
      ...host.getSlottedTaskIds(projectId),
      ...host.getActiveAgentIds(projectId),
      ...result.reattached,
    ]);
    const excludeWorktreeKeys = new Set([
      ...excludeIds,
      ...(host.getSlottedWorktreeKeys?.(projectId) ?? []),
    ]);
    const excludeWorktreePaths = new Set(
      (host.getSlottedWorktreePaths?.(projectId) ?? []).map((p) => path.resolve(p))
    );

    // 2. Stale heartbeat recovery
    const staleResult = await this.recoverFromStaleHeartbeats(
      projectId,
      repoPath,
      excludeIds,
      host
    );
    result.reattached.push(...staleResult.reattached);
    result.requeued.push(...staleResult.requeued);

    staleResult.reattached.forEach((taskId) => excludeIds.add(taskId));
    staleResult.requeued.forEach((taskId) => excludeIds.add(taskId));
    staleResult.reattached.forEach((taskId) => excludeWorktreeKeys.add(taskId));
    staleResult.requeued.forEach((taskId) => excludeWorktreeKeys.add(taskId));

    // 3. Orphaned in_progress tasks
    const orphanResult = await this.recoverOrphanedTasks(projectId, repoPath, excludeIds);
    result.requeued.push(...orphanResult);
    orphanResult.forEach((taskId) => excludeIds.add(taskId));
    orphanResult.forEach((taskId) => excludeWorktreeKeys.add(taskId));

    // 4. Stranded merge retries: in_progress but no assignee, slot, or active agent.
    const assigneeLessResult = await this.recoverAssigneeLessInProgressTasks(
      projectId,
      repoPath,
      excludeIds
    );
    result.requeued.push(...assigneeLessResult);
    assigneeLessResult.forEach((taskId) => excludeIds.add(taskId));
    assigneeLessResult.forEach((taskId) => excludeWorktreeKeys.add(taskId));

    // 5. Stale git lock removal
    const lockCleaned = await this.cleanStaleGitLocks(projectId, repoPath);
    if (lockCleaned) result.cleaned.push(".git/index.lock");

    // 6. Reconcile slots vs task store
    if (host.removeStaleSlot) {
      const reconciled = await this.reconcileSlots(projectId, repoPath, host);
      result.cleaned.push(...reconciled);
    }

    // 7. Replay persisted merge cleanup intents (restart-safe deferred cleanup)
    const replayed = await this.replayPendingCleanupIntents(
      projectId,
      repoPath,
      excludeWorktreeKeys,
      excludeWorktreePaths
    );
    if (replayed.length > 0) {
      result.cleaned.push(...replayed.map((id) => `cleanup_intent:${id}`));
    }

    // 8. Prune orphan worktrees (closed/missing tasks), excluding active slot keys/paths
    const pruned = await this.pruneOrphanWorktrees(
      projectId,
      repoPath,
      excludeIds,
      excludeWorktreeKeys,
      excludeWorktreePaths
    );
    if (pruned.length > 0) {
      result.cleaned.push(...pruned.map((id) => `worktree:${id}`));
      log.info("Pruned orphan worktrees", { projectId, pruned });
    }

    // 9. Cleanup stale inactive open/blocked worktrees (TTL-based safety net)
    const staleInactive = await this.cleanupStaleInactiveWorktrees(
      projectId,
      repoPath,
      excludeIds,
      excludeWorktreeKeys,
      excludeWorktreePaths
    );
    if (staleInactive.length > 0) {
      result.cleaned.push(...staleInactive.map((id) => `stale_inactive_worktree:${id}`));
    }

    return result;
  }

  // ─── GUPP: scan assignment.json files ───

  private async recoverFromAssignments(
    projectId: string,
    repoPath: string,
    host: RecoveryHost
  ): Promise<{ reattached: string[]; requeued: string[] }> {
    const worktreeBase = this.branchManager.getWorktreeBasePath();
    const fromWorktrees =
      await this.crashRecovery.findOrphanedAssignmentsFromWorktrees(worktreeBase);
    const fromMainRepo = await this.crashRecovery.findOrphanedAssignments(repoPath);
    const byTaskId = new Map<string, { taskId: string; assignment: GuppAssignment }>();
    for (const o of fromMainRepo)
      byTaskId.set(o.taskId, o as { taskId: string; assignment: GuppAssignment });
    for (const o of fromWorktrees)
      byTaskId.set(o.taskId, o as { taskId: string; assignment: GuppAssignment });
    const orphaned = [...byTaskId.values()];

    if (orphaned.length === 0) return { reattached: [], requeued: [] };

    const allIssues = await this.taskStore.listAll(projectId);
    const idToIssue = new Map(allIssues.map((i) => [i.id, i]));
    const reattached: string[] = [];
    const requeued: string[] = [];

    for (const { taskId, assignment } of orphaned) {
      const task = idToIssue.get(taskId);
      if (!task) {
        log.warn("Recovery: task not found, cleaning up assignment", { projectId, taskId });
        await this.removeWorktreeIfNeeded(repoPath, taskId, assignment.worktreePath);
        await this.deleteAssignment(repoPath, taskId, assignment.worktreePath);
        continue;
      }

      if ((task.status as string) !== "in_progress") {
        log.info("Recovery: task no longer in_progress, removing stale assignment", {
          projectId,
          taskId,
          status: task.status,
        });
        await this.removeWorktreeIfNeeded(repoPath, taskId, assignment.worktreePath);
        await this.deleteAssignment(repoPath, taskId, assignment.worktreePath);
        continue;
      }

      const wtPath = assignment.worktreePath;
      const heartbeat = wtPath ? await heartbeatService.readHeartbeat(wtPath, taskId) : null;
      const pidAlive =
        heartbeat != null &&
        typeof heartbeat.processGroupLeaderPid === "number" &&
        heartbeat.processGroupLeaderPid > 0 &&
        isProcessAlive(heartbeat.processGroupLeaderPid);

      if (!pidAlive && host.handleCompletedAssignment) {
        const terminalResult = await this.readTerminalAssignmentResult(assignment);
        if (terminalResult) {
          const completed = await host.handleCompletedAssignment(
            projectId,
            repoPath,
            task,
            assignment
          );
          if (completed) {
            reattached.push(taskId);
            continue;
          }
        }
      }

      if (pidAlive && assignment.phase === "coding" && host.reattachSlot) {
        const attached = await host.reattachSlot(projectId, repoPath, task, assignment);
        if (attached) {
          reattached.push(taskId);
          continue;
        }
      }

      if (assignment.phase === "review" && host.resumeReviewPhase) {
        const resumed = await host.resumeReviewPhase(projectId, repoPath, task, assignment, {
          pidAlive,
        });
        if (resumed) {
          reattached.push(taskId);
          continue;
        }
      }

      log.info("Recovery: PID dead or missing, requeuing task", { projectId, taskId });
      try {
        await this.taskStore.update(projectId, taskId, { status: "open", assignee: "" });
        await this.taskStore.comment(
          projectId,
          taskId,
          "Agent crashed (backend restart). Task requeued for next attempt."
        );
      } catch (err) {
        log.warn("Recovery: failed to requeue task", { projectId, taskId, err });
      }
      await this.removeWorktreeIfNeeded(repoPath, taskId, assignment.worktreePath);
      await this.deleteAssignment(repoPath, taskId, assignment.worktreePath);
      requeued.push(taskId);
    }

    return { reattached, requeued };
  }

  // ─── Stale heartbeat recovery ───

  private async recoverFromStaleHeartbeats(
    projectId: string,
    repoPath: string,
    excludeIds: Set<string>,
    host: RecoveryHost
  ): Promise<{ reattached: string[]; requeued: string[] }> {
    const worktreeBase = this.branchManager.getWorktreeBasePath();
    const stale = await heartbeatService.findStaleHeartbeats(worktreeBase);
    const reattached: string[] = [];
    const requeued: string[] = [];

    for (const { taskId, heartbeat } of stale) {
      if (excludeIds.has(taskId)) continue;
      const staleSec = Math.round((Date.now() - heartbeat.lastOutputTimestamp) / 1000);
      log.warn("Stale heartbeat detected", {
        projectId,
        taskId,
        staleSec,
        threshold: HEARTBEAT_STALE_MS / 1000,
      });

      eventLogService
        .append(repoPath, {
          timestamp: new Date().toISOString(),
          projectId,
          taskId,
          event: "recovery.stale_heartbeat",
          data: { staleSec, threshold: HEARTBEAT_STALE_MS / 1000 },
        })
        .catch((err) => log.debug("Best-effort event log append failed", { taskId, err }));

      try {
        const task = await this.taskStore.show(projectId, taskId);
        if (task.status === "in_progress") {
          const staleForMs = Math.max(0, Date.now() - heartbeat.lastOutputTimestamp);
          const pidAlive =
            typeof heartbeat.processGroupLeaderPid === "number" &&
            heartbeat.processGroupLeaderPid > 0 &&
            isProcessAlive(heartbeat.processGroupLeaderPid);
          const exceededSuspendGrace =
            Date.now() - heartbeat.lastOutputTimestamp > AGENT_SUSPEND_GRACE_MS;
          const assignment = await this.readAssignment(repoPath, taskId);

          if (!pidAlive && assignment && host.handleCompletedAssignment) {
            const terminalResult = await this.readTerminalAssignmentResult(assignment);
            if (terminalResult) {
              const completed = await host.handleCompletedAssignment(
                projectId,
                repoPath,
                task,
                assignment
              );
              if (completed) {
                reattached.push(taskId);
                continue;
              }
            }
          }

          if (
            pidAlive &&
            !exceededSuspendGrace &&
            staleForMs <= RECOVERABLE_HEARTBEAT_GAP_MAX_MS &&
            assignment &&
            host.handleRecoverableHeartbeatGap
          ) {
            const handled = await host.handleRecoverableHeartbeatGap(
              projectId,
              repoPath,
              task,
              assignment
            );
            if (handled) {
              reattached.push(taskId);
              continue;
            }
          }

          if (pidAlive) {
            log.info("Terminating orphaned agent process", {
              taskId,
              processGroupLeaderPid: heartbeat.processGroupLeaderPid,
              exceededSuspendGrace,
              staleForMs,
              maxRecoverableGapMs: RECOVERABLE_HEARTBEAT_GAP_MAX_MS,
              hasAssignment: Boolean(assignment),
            });
            await terminateProcessGroup(heartbeat.processGroupLeaderPid, 2000);
          }
          await this.recoverTask(projectId, repoPath, task);
          requeued.push(taskId);
        }
      } catch {
        // Task may not exist — clean up worktree only in Worktree mode (Branches: no worktree)
        const settings = await this.projectService.getSettings(projectId);
        if (settings.gitWorkingMode !== "branches") {
          try {
            await this.branchManager.removeTaskWorktree(repoPath, taskId);
          } catch {
            // Ignore
          }
        }
      }
    }

    return { reattached, requeued };
  }

  // ─── Orphaned in_progress tasks ───

  /**
   * Reset in-progress tasks assigned to an agent when no process exists for that assignee.
   * "Process exists" is determined by excludeIds: task IDs in a slot (getSlottedTaskIds) or
   * in active agent registry (getActiveAgentIds). Human-assigned tasks are never included
   * (listInProgressWithAgentAssignee returns only agent assignees).
   */
  private async recoverOrphanedTasks(
    projectId: string,
    repoPath: string,
    excludeIds: Set<string>
  ): Promise<string[]> {
    const orphans = await this.taskStore.listInProgressWithAgentAssignee(projectId);
    const toRecover = orphans.filter((t) => !excludeIds.has(t.id));
    const recovered: string[] = [];

    for (const task of toRecover) {
      try {
        if (
          await this.hasFreshRecoveryHeartbeatGuard(
            repoPath,
            task.id,
            task.updated_at ?? null,
            undefined
          )
        ) {
          continue;
        }
        await this.recoverTask(projectId, repoPath, task);
        recovered.push(task.id);
        eventLogService
          .append(repoPath, {
            timestamp: new Date().toISOString(),
            projectId,
            taskId: task.id,
            event: "recovery.agent_assignee_no_process_reset",
            data: { assignee: task.assignee ?? null, reason: "no process for agent assignee" },
          })
          .catch((err) =>
            log.debug("Best-effort event log append failed", { taskId: task.id, err })
          );
        await this.taskStore
          .comment(
            projectId,
            task.id,
            "Watchdog: no running process for agent assignee. Task requeued for next attempt."
          )
          .catch((err) =>
            log.warn("Failed to comment on recovered task", { taskId: task.id, err })
          );
      } catch (err) {
        log.warn("Failed to recover task", { taskId: task.id, err: (err as Error).message });
      }
    }

    if (recovered.length > 0) {
      log.warn("Recovered orphaned tasks", { projectId, count: recovered.length, recovered });
    }
    return recovered;
  }

  private async recoverAssigneeLessInProgressTasks(
    projectId: string,
    repoPath: string,
    excludeIds: Set<string>
  ): Promise<string[]> {
    const stranded = await this.taskStore.listInProgressWithoutAssignee(projectId);
    const cutoffMs = Date.now() - HEARTBEAT_STALE_MS;
    const toRecover = stranded.filter((task) => {
      if (excludeIds.has(task.id)) return false;
      const updatedAtMs = Date.parse(task.updated_at ?? "");
      return Number.isFinite(updatedAtMs) && updatedAtMs <= cutoffMs;
    });
    const recovered: string[] = [];

    for (const task of toRecover) {
      try {
        if (
          await this.hasFreshRecoveryHeartbeatGuard(
            repoPath,
            task.id,
            task.updated_at ?? null,
            undefined
          )
        ) {
          continue;
        }
        await this.recoverTask(projectId, repoPath, task);
        recovered.push(task.id);
        eventLogService
          .append(repoPath, {
            timestamp: new Date().toISOString(),
            projectId,
            taskId: task.id,
            event: "recovery.in_progress_without_assignee_reset",
            data: {
              reason: "in_progress task had no assignee, slot, or active agent",
              updatedAt: task.updated_at ?? null,
            },
          })
          .catch((err) =>
            log.debug("Best-effort event log append failed", { taskId: task.id, err })
          );
        await this.taskStore
          .comment(
            projectId,
            task.id,
            "Watchdog: in-progress task had no assignee or active slot. Task requeued for next attempt."
          )
          .catch((err) =>
            log.warn("Failed to comment on recovered assignee-less task", {
              taskId: task.id,
              err,
            })
          );
      } catch (err) {
        log.warn("Failed to recover assignee-less in-progress task", {
          taskId: task.id,
          err: (err as Error).message,
        });
      }
    }

    if (recovered.length > 0) {
      log.warn("Recovered assignee-less in-progress tasks", { projectId, count: recovered.length, recovered });
    }
    return recovered;
  }

  // ─── Stale git lock removal ───

  private async cleanStaleGitLocks(projectId: string, repoPath: string): Promise<boolean> {
    const lockPath = path.join(repoPath, ".git", "index.lock");
    try {
      const stat = await fs.stat(lockPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs > GIT_LOCK_STALE_MS) {
        log.warn("Removing stale .git/index.lock", { projectId, repoPath, ageSec: Math.round(ageMs / 1000) });
        await fs.unlink(lockPath);
        eventLogService
          .append(repoPath, {
            timestamp: new Date().toISOString(),
            projectId,
            taskId: "",
            event: "recovery.stale_lock_removed",
            data: { ageMs },
          })
          .catch((err) => log.debug("Best-effort event log append failed", { err }));
        return true;
      }
    } catch {
      // No lock file — healthy
    }
    return false;
  }

  // ─── Slot reconciliation ───

  private async reconcileSlots(
    projectId: string,
    repoPath: string,
    host: RecoveryHost
  ): Promise<string[]> {
    const slottedIds = host.getSlottedTaskIds(projectId);
    const activeAgentIds = new Set(host.getActiveAgentIds(projectId));
    if (slottedIds.length === 0) return [];

    const allIssues = await this.taskStore.listAll(projectId);
    const idToIssue = new Map(allIssues.map((i) => [i.id, i]));
    const validIds = new Set(idToIssue.keys());

    // Do not remove slots when listAll returned no tasks; avoid killing agents on empty list.
    if (validIds.size === 0) {
      log.warn("Skipping slot reconciliation: listAll returned 0 tasks but we have slots", {
        projectId,
        slottedCount: slottedIds.length,
        slottedTaskIds: slottedIds,
      });
      return [];
    }

    const stale: string[] = [];

    for (const taskId of slottedIds) {
      if (activeAgentIds.has(taskId)) {
        // The orchestrator still has an active agent registered for this task.
        // Heartbeat files can lag behind process start, so avoid premature slot eviction.
        log.info("Skipping slot recovery due to guard", {
          projectId,
          taskId,
          guard: "active_agent",
        });
        continue;
      }

      if (!validIds.has(taskId)) {
        log.warn("Removing stale slot: task no longer in task store", { projectId, taskId });
        await host.removeStaleSlot!(projectId, taskId, repoPath);
        stale.push(taskId);
        continue;
      }

      const task = idToIssue.get(taskId);
      if (!task) continue;

      const assignment = await this.readAssignment(repoPath, taskId);
      if (!assignment) continue;

      const assignmentAgeMs = Date.now() - new Date(assignment.createdAt).getTime();
      if (Number.isFinite(assignmentAgeMs) && assignmentAgeMs >= 0) {
        if (assignmentAgeMs < SLOT_RECOVERY_GRACE_MS) {
          log.info("Skipping slot recovery due to guard", {
            projectId,
            taskId,
            guard: "grace_window",
            assignmentAgeMs,
            graceMs: SLOT_RECOVERY_GRACE_MS,
          });
          continue;
        }
      }

      const heartbeat = assignment.worktreePath
        ? await heartbeatService.readHeartbeat(assignment.worktreePath, taskId)
        : null;
      const assignmentAgeMsSafe =
        Number.isFinite(assignmentAgeMs) && assignmentAgeMs >= 0 ? assignmentAgeMs : null;
      const pidAlive =
        heartbeat != null &&
        typeof heartbeat.processGroupLeaderPid === "number" &&
        heartbeat.processGroupLeaderPid > 0 &&
        isProcessAlive(heartbeat.processGroupLeaderPid);
      const heartbeatHasRecentOutput =
        heartbeat != null &&
        Number.isFinite(heartbeat.lastOutputTimestamp) &&
        Date.now() - heartbeat.lastOutputTimestamp <= HEARTBEAT_STALE_MS;
      const heartbeatIsFresh =
        heartbeat != null &&
        Number.isFinite(heartbeat.heartbeatTimestamp) &&
        Date.now() - heartbeat.heartbeatTimestamp <= HEARTBEAT_STALE_MS;

      // Some agent backends do not expose a stable local process-group PID and report 0/undefined.
      // If heartbeat output is still fresh (or heartbeat itself is fresh), treat the slot as active
      // and avoid watchdog reset loops for long-running/silent turns.
      const withinNoPidGuardAge =
        assignmentAgeMsSafe == null || assignmentAgeMsSafe <= HEARTBEAT_WITHOUT_PID_MAX_AGE_MS;
      if (!pidAlive && (heartbeatHasRecentOutput || heartbeatIsFresh) && withinNoPidGuardAge) {
        log.info("Skipping slot recovery due to guard", {
          projectId,
          taskId,
          guard: heartbeatHasRecentOutput
            ? "recent_output_without_pid"
            : "fresh_heartbeat_without_pid",
          assignmentAgeMs: assignmentAgeMsSafe,
          maxGuardAgeMs: HEARTBEAT_WITHOUT_PID_MAX_AGE_MS,
        });
        continue;
      }

      if (!pidAlive && host.handleCompletedAssignment) {
        const terminalResult = await this.readTerminalAssignmentResult(assignment);
        if (terminalResult) {
          log.warn("Completing slotted task from terminal result", {
            projectId,
            taskId,
            phase: assignment.phase,
            attempt: assignment.attempt,
            status: terminalResult,
          });
          const completed = await host.handleCompletedAssignment(
            projectId,
            repoPath,
            task,
            assignment
          );
          if (completed) {
            stale.push(taskId);
            continue;
          }
        }
      }

      if (!pidAlive) {
        log.warn("Recovering dead slotted task", {
          projectId,
          taskId,
          phase: assignment.phase,
          attempt: assignment.attempt,
        });
        await host.removeStaleSlot!(projectId, taskId, repoPath);
        await this.recoverTask(projectId, repoPath, task);
        stale.push(taskId);
      }
    }

    return stale;
  }

  // ─── Orphan worktree pruning ───

  private async pruneOrphanWorktrees(
    projectId: string,
    repoPath: string,
    excludeIds: Set<string>,
    excludeWorktreeKeys: Set<string>,
    excludeWorktreePaths: Set<string>
  ): Promise<string[]> {
    const settings = await this.projectService.getSettings(projectId);
    if (settings.gitWorkingMode === "branches") return [];
    return this.branchManager.pruneOrphanWorktrees(
      repoPath,
      projectId,
      excludeIds,
      excludeWorktreeKeys,
      excludeWorktreePaths,
      this.taskStore
    );
  }

  private async replayPendingCleanupIntents(
    projectId: string,
    repoPath: string,
    excludeWorktreeKeys: Set<string>,
    excludeWorktreePaths: Set<string>
  ): Promise<string[]> {
    const intents = await worktreeCleanupIntentService.list(repoPath, projectId);
    if (intents.length === 0) return [];
    const tasks = await this.taskStore.listAll(projectId);
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const cleaned: string[] = [];
    for (const intent of intents) {
      const worktreeKey = intent.worktreeKey ?? intent.taskId;
      const resolvedPath = intent.worktreePath ? path.resolve(intent.worktreePath) : null;
      if (excludeWorktreeKeys.has(worktreeKey)) continue;
      if (resolvedPath && excludeWorktreePaths.has(resolvedPath)) continue;
      const task = taskById.get(intent.taskId);
      if (task && String(task.status ?? "") === "in_progress") {
        log.warn("Skipping cleanup intent for in-progress task", {
          projectId,
          taskId: intent.taskId,
          branchName: intent.branchName,
          worktreePath: intent.worktreePath,
        });
        continue;
      }
      try {
        if (intent.gitWorkingMode === "branches") {
          await this.branchManager.deleteBranch(repoPath, intent.branchName);
        } else {
          await this.branchManager.removeTaskWorktree(
            repoPath,
            worktreeKey,
            intent.worktreePath ?? undefined
          );
          await this.branchManager.deleteBranch(repoPath, intent.branchName);
        }
        await worktreeCleanupIntentService.removeBestEffort(repoPath, projectId, intent.taskId);
        cleaned.push(intent.taskId);
        eventLogService
          .append(repoPath, {
            timestamp: new Date().toISOString(),
            projectId,
            taskId: intent.taskId,
            event: "worktree.cleanup_succeeded",
            data: {
              trigger: "recovery_replay",
              branchName: intent.branchName,
              worktreePath: intent.worktreePath,
              worktreeKey,
            },
          })
          .catch(() => {});
      } catch (err) {
        eventLogService
          .append(repoPath, {
            timestamp: new Date().toISOString(),
            projectId,
            taskId: intent.taskId,
            event: "worktree.cleanup_failed",
            data: {
              trigger: "recovery_replay",
              branchName: intent.branchName,
              worktreePath: intent.worktreePath,
              worktreeKey,
              error: err instanceof Error ? err.message : String(err),
            },
          })
          .catch(() => {});
      }
    }
    return cleaned;
  }

  private async hasFreshRecoveryHeartbeatGuard(
    repoPath: string,
    taskId: string,
    taskUpdatedAt: string | null | undefined,
    assignmentWorktreePath?: string
  ): Promise<boolean> {
    const now = Date.now();
    const candidatePaths = new Set<string>();
    if (assignmentWorktreePath) candidatePaths.add(assignmentWorktreePath);
    candidatePaths.add(this.branchManager.getWorktreePath(taskId));

    for (const worktreePath of candidatePaths) {
      const heartbeat = await heartbeatService.readHeartbeat(worktreePath, taskId);
      if (!heartbeat) continue;
      const pidAlive =
        typeof heartbeat.processGroupLeaderPid === "number" &&
        heartbeat.processGroupLeaderPid > 0 &&
        isProcessAlive(heartbeat.processGroupLeaderPid);
      if (pidAlive) {
        log.info("Skipping recovery due to live heartbeat PID", { taskId, worktreePath });
        return true;
      }

      const heartbeatFresh =
        Number.isFinite(heartbeat.heartbeatTimestamp) &&
        now - heartbeat.heartbeatTimestamp <= HEARTBEAT_STALE_MS;
      const outputFresh =
        Number.isFinite(heartbeat.lastOutputTimestamp) &&
        now - heartbeat.lastOutputTimestamp <= HEARTBEAT_STALE_MS;
      const updatedAtMs = taskUpdatedAt ? Date.parse(taskUpdatedAt) : Number.NaN;
      const withinNoPidGuardAge =
        !Number.isFinite(updatedAtMs) || now - updatedAtMs <= HEARTBEAT_WITHOUT_PID_MAX_AGE_MS;
      if ((heartbeatFresh || outputFresh) && withinNoPidGuardAge) {
        log.info("Skipping recovery due to fresh heartbeat without PID", {
          taskId,
          worktreePath,
          heartbeatFresh,
          outputFresh,
        });
        return true;
      }
    }
    return false;
  }

  private async cleanupStaleInactiveWorktrees(
    projectId: string,
    repoPath: string,
    excludeTaskIds: Set<string>,
    excludeWorktreeKeys: Set<string>,
    excludeWorktreePaths: Set<string>
  ): Promise<string[]> {
    const settings = await this.projectService.getSettings(projectId);
    if (settings.gitWorkingMode === "branches") return [];
    const worktrees = await this.branchManager.listTaskWorktrees(repoPath);
    if (worktrees.length === 0) return [];
    const tasks = await this.taskStore.listAll(projectId);
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const now = Date.now();
    const cleaned: string[] = [];

    for (const { taskId: worktreeKey, worktreePath } of worktrees) {
      const resolvedPath = path.resolve(worktreePath);
      if (excludeTaskIds.has(worktreeKey)) continue;
      if (excludeWorktreeKeys.has(worktreeKey)) continue;
      if (excludeWorktreePaths.has(resolvedPath)) continue;

      const task = taskById.get(worktreeKey);
      if (!task) continue;
      const status = String(task.status ?? "");
      if (status !== "open" && status !== "blocked") continue;

      const updatedAt = Date.parse(String(task.updated_at ?? ""));
      if (!Number.isFinite(updatedAt)) continue;
      if (now - updatedAt < STALE_INACTIVE_WORKTREE_MS) continue;

      const assignment = await this.readAssignment(repoPath, task.id);
      if (assignment?.worktreePath && path.resolve(assignment.worktreePath) === resolvedPath) {
        continue;
      }
      if (assignment?.worktreePath) {
        const heartbeat = await heartbeatService.readHeartbeat(assignment.worktreePath, task.id);
        const pid =
          heartbeat && typeof heartbeat.processGroupLeaderPid === "number"
            ? heartbeat.processGroupLeaderPid
            : 0;
        if (pid > 0 && isProcessAlive(pid)) {
          continue;
        }
      }

      try {
        await this.branchManager.removeTaskWorktree(repoPath, worktreeKey, worktreePath);
        cleaned.push(worktreeKey);
        eventLogService
          .append(repoPath, {
            timestamp: new Date().toISOString(),
            projectId,
            taskId: task.id,
            event: "worktree.cleanup_succeeded",
            data: {
              trigger: "stale_inactive_ttl",
              worktreeKey,
              worktreePath,
              taskStatus: status,
              staleForMs: now - updatedAt,
            },
          })
          .catch(() => {});
      } catch (err) {
        eventLogService
          .append(repoPath, {
            timestamp: new Date().toISOString(),
            projectId,
            taskId: task.id,
            event: "worktree.cleanup_failed",
            data: {
              trigger: "stale_inactive_ttl",
              worktreeKey,
              worktreePath,
              taskStatus: status,
              staleForMs: now - updatedAt,
              error: err instanceof Error ? err.message : String(err),
            },
          })
          .catch(() => {});
      }
    }
    return cleaned;
  }

  // ─── Shared helpers ───

  private async recoverTask(projectId: string, repoPath: string, task: StoredTask): Promise<void> {
    const settings = await this.projectService.getSettings(projectId);
    const gitWorkingMode = settings.gitWorkingMode ?? "worktree";

    // In Branches mode, agent runs in repoPath; no worktree. In Worktree mode, use worktree path.
    const workPath =
      gitWorkingMode === "branches" ? repoPath : this.branchManager.getWorktreePath(task.id);
    try {
      await fs.access(workPath);
      await this.branchManager.commitWip(workPath, task.id);
    } catch {
      // Worktree/path may not exist
    }

    // Clean up worktree only in Worktree mode (Branches mode: no worktree to remove)
    if (gitWorkingMode !== "branches") {
      try {
        const worktrees = await this.branchManager.listTaskWorktrees(repoPath);
        const found = worktrees.find((w) => w.taskId === task.id);
        await this.branchManager.removeTaskWorktree(repoPath, task.id, found?.worktreePath);
      } catch {
        // Worktree may not exist
      }
    }

    await this.taskStore.update(projectId, task.id, {
      status: "open",
      assignee: "",
    });
  }

  private async readAssignment(repoPath: string, taskId: string): Promise<GuppAssignment | null> {
    try {
      const readAssignmentAt = (
        this.crashRecovery as {
          readAssignmentAt?: (
            basePath: string,
            assignmentTaskId: string
          ) => Promise<GuppAssignment | null>;
        }
      ).readAssignmentAt;
      if (typeof readAssignmentAt !== "function") return null;
      const worktreePath = this.branchManager.getWorktreePath(taskId);
      return (
        (await readAssignmentAt(worktreePath, taskId)) ?? (await readAssignmentAt(repoPath, taskId))
      );
    } catch {
      return null;
    }
  }

  private async readTerminalAssignmentResult(assignment: GuppAssignment): Promise<string | null> {
    const resultPath = path.join(path.dirname(assignment.promptPath), "result.json");
    try {
      const raw = await fs.readFile(resultPath, "utf-8");
      const parsed = JSON.parse(raw) as { status?: string };
      const status = typeof parsed?.status === "string" ? parsed.status.toLowerCase() : "";
      return ["success", "failed", "approved", "rejected"].includes(status) ? status : null;
    } catch {
      return null;
    }
  }

  /**
   * Remove worktree when the path is a task worktree (not main repo).
   * In Branches mode assignment.worktreePath === repoPath; in Worktree mode it's a temp path.
   * Uses actual path so we clean up correctly when os.tmpdir() changed since creation.
   */
  private async removeWorktreeIfNeeded(
    repoPath: string,
    taskId: string,
    worktreePath?: string
  ): Promise<void> {
    if (!worktreePath) return;
    const repoResolved = path.resolve(repoPath);
    const wtResolved = path.resolve(worktreePath);
    if (repoResolved === wtResolved) return; // Branches mode: no worktree
    try {
      await this.branchManager.removeTaskWorktree(repoPath, taskId, worktreePath);
    } catch {
      // Best effort; worktree may already be gone
    }
  }

  private async deleteAssignment(
    repoPath: string,
    taskId: string,
    worktreePath?: string
  ): Promise<void> {
    if (worktreePath) {
      await this.crashRecovery.deleteAssignmentAt(worktreePath, taskId);
    }
    const { OPENSPRINT_PATHS } = await import("@opensprint/shared");
    const assignmentPath = path.join(
      repoPath,
      OPENSPRINT_PATHS.active,
      taskId,
      OPENSPRINT_PATHS.assignment
    );
    try {
      await fs.unlink(assignmentPath);
    } catch {
      // File may not exist
    }
  }
}

export const recoveryService = new RecoveryService();
