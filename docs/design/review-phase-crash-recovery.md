# Review-Phase Crash Recovery

## Problem

When the OpenSprint backend restarts while a task is **in review** (Reviewer agent running), crash recovery requeues the task and spawns a **new Coder** instead of resuming with a new Reviewer. The Coder's prior work is preserved (branch with commits) but the user expected the review to continue.

**Root cause:** `CrashRecoveryService.performCrashRecovery` only has a special path for `currentPhase === "coding"` (`tryAdvanceToReview`). When `currentPhase === "review"` and the Reviewer PID is dead, it falls through to the generic requeue path.

## Current Behavior

1. Coder completes → tests pass → orchestrator transitions to `enter_review`, persists state, spawns Reviewer.
2. User restarts backend (or backend crashes).
3. Reviewer subprocess is killed (child of Node process).
4. On boot: `recoverFromPersistedState` loads state with `currentPhase: "review"`, `agentPid` (dead).
5. `performCrashRecovery` runs; `if (persisted.currentPhase === "coding")` is false.
6. Falls through: `clearPersistedState`, `removeTaskWorktree`, `bd update status=open`, `loopActive = false`.
7. Loop runs, `bd ready` returns the task, new Coder is spawned.

## Intended Behavior

When `currentPhase === "review"` and the Reviewer is dead: **resume review** by spawning a new Reviewer, not requeueing.

---

## Implementation Plan

### 1. Add `tryResumeReview` in `CrashRecoveryService`

**File:** `packages/backend/src/services/crash-recovery.service.ts`

Add a new private method `tryResumeReview` that:

1. **Validate preconditions**
   - `worktreePath` exists and is usable
   - Branch has commits (sanity check; Coder work should be preserved)
   - `reviewMode !== "never"` (if `"never"`, we would have merged; edge case: could call `performMergeAndDone` if we somehow had review phase with `"never"`)

2. **Restore orchestrator state**
   - `state.status.currentTask = taskId`
   - `state.status.currentPhase = "review"`
   - `state.activeBranchName = branchName`
   - `state.activeTaskTitle = persisted.currentTaskTitle ?? null`
   - `state.activeWorktreePath = worktreePath`
   - `state.attempt = persisted.attempt`
   - `state.agent.startedAt = persisted.startedAt ?? new Date().toISOString()`
   - `state.loopActive = true`

3. **Fetch task and invoke review**
   - `const task = await deps.beads.show(repoPath, taskId)`
   - `await callbacks.persistState(projectId, repoPath)` (before spawn, so a second crash can resume again)
   - Broadcast `task.updated` and `execute.status` (phase: review)
   - `await callbacks.executeReviewPhase(projectId, repoPath, task, branchName)`

4. **Return** `true` on success, `false` if any precondition fails or an error is thrown.

**Dependencies:** `executeReviewPhase` builds context from repo/beads and does not require in-memory `phaseResult`. The worktree, branch, and task dir contents are sufficient.

### 2. Branch in `performCrashRecovery`

**File:** `packages/backend/src/services/crash-recovery.service.ts`

In `performCrashRecovery`, after the coding-phase `tryAdvanceToReview` block, add:

```ts
if (worktreePath && persisted && persisted.currentPhase === "review") {
  const resumed = await this.tryResumeReview(
    projectId,
    repoPath,
    taskId,
    branchName,
    worktreePath,
    persisted,
    state,
    deps,
    callbacks
  );
  if (resumed) return;
}
```

Place this **before** `await callbacks.clearPersistedState(repoPath)` so we don't clear state when resuming.

### 3. Handle `reviewMode === "never"`

If `reviewMode === "never"`, the orchestrator never enters review; it calls `performMergeAndDone` directly after coding. So `currentPhase === "review"` with `reviewMode === "never"` is effectively unreachable in normal flow. For robustness: in `tryResumeReview`, if settings indicate `reviewMode === "never"`, treat as resume failure and fall through to requeue (or optionally call `performMergeAndDone` — merging is safe since Coder work is done). Recommend: **fall through to requeue** to avoid subtle edge cases; the task will be picked up and the Coder will quickly "complete" again, then merge.

### 4. Edge Cases and Fallbacks

| Scenario                         | Handling                                                  |
| -------------------------------- | --------------------------------------------------------- |
| Worktree path missing or invalid | `tryResumeReview` returns false → fall through to requeue |
| Branch deleted                   | `tryResumeReview` catches, returns false → requeue        |
| Commit count 0                   | Unlikely in review; return false → requeue                |
| `executeReviewPhase` throws      | Catch in `tryResumeReview`, log, return false → requeue   |
| Task not found in beads          | Return false → requeue                                    |

In all failure cases, the existing requeue path still runs: clear state, remove worktree (if present), preserve/delete branch per commits, mark task open, increment totalFailed.

### 5. Tests

**File:** `packages/backend/src/__tests__/crash-recovery.service.test.ts` (new or extend `crash-recovery-gupp.test.ts`)

- **Resume review on restart:** Persisted state with `currentPhase: "review"`, dead PID, worktree and branch present → `executeReviewPhase` called, no requeue.
- **Fallback to requeue:** Persisted state `currentPhase: "review"`, worktree missing → requeue, no `executeReviewPhase`.
- **Round-trip:** Simulate coding → enter_review → persist → kill backend → boot with dead PID → verify new Reviewer spawned (integration-style test if feasible).

### 6. Event Logging

In `tryResumeReview`, log an event (e.g. `crash_recovery.resume_review`) for observability:

```ts
eventLogService
  .append(repoPath, {
    timestamp: new Date().toISOString(),
    projectId,
    taskId,
    event: "crash_recovery.resume_review",
    data: { branchName, worktreePath },
  })
  .catch(() => {});
```

### 7. Files to Modify

| File                                                      | Changes                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| `packages/backend/src/services/crash-recovery.service.ts` | Add `tryResumeReview`, add branch in `performCrashRecovery` |
| `packages/backend/src/__tests__/`                         | Add or extend crash recovery tests for review-phase resume  |

### 8. Verification

- Restart backend while a task is in review → new Reviewer spawns, review continues.
- Restart backend while a task is in coding → existing `tryAdvanceToReview` path unchanged.
- Restart backend while idle → no change.

---

## Summary

Add a `tryResumeReview` path in crash recovery that, when `currentPhase === "review"` and the Reviewer PID is dead, restores orchestrator state and calls `executeReviewPhase` instead of requeueing. Keep all existing fallbacks and edge-case handling in the requeue path.
