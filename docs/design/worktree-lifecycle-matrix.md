# Worktree Lifecycle Matrix

This document captures the runtime cleanup guarantees for Open Sprint worktrees and the hardening implemented in March 2026.

## State x Trigger matrix

| Task state | Trigger | Previous behavior | Current behavior |
| --- | --- | --- | --- |
| `in_progress` (active slot) | Recovery prune | Could be misclassified in epic mode when key != task id | Explicitly excluded by slotted worktree keys and resolved paths |
| `open` or `blocked` | Recovery prune | Not removed unless task became `closed` or missing | TTL cleanup removes stale inactive worktrees (`OPENSPRINT_STALE_INACTIVE_WORKTREE_MS`, default 24h) when no live assignment/process remains |
| `closed` | Recovery prune | Removed by `pruneOrphanWorktrees` | Same behavior, now also path/key-aware exclusions |
| missing task row | Recovery prune | Removed by `pruneOrphanWorktrees` | Same behavior, now slot-aware by key/path |
| merged task (push pending) | Post-completion | Deferred cleanup in memory only | Deferred cleanup intent is persisted and replayed after restart |
| project archived | `archiveProject()` | Index removed, worktrees left behind | Worktrees are removed before project is archived from index |
| project deleted | `deleteProject()` | Best-effort worktree cleanup | Same behavior, plus cleanup-intent metadata cleared |

## Trigger inventory

- Dispatch: worktree created/reused via `BranchManager.createTaskWorktree`.
- Merge success: deferred cleanup intent registered by `MergeCoordinatorService`.
- Post-completion push success: cleanup executes immediately.
- Startup/watchdog recovery: cleanup intents replayed, orphan prune applied, stale inactive TTL cleanup applied.
- Project archive/delete: explicit worktree cleanup pass runs before index removal.

## Cleanup intent durability

- Persisted file: `.opensprint/runtime/worktree-cleanup-intents.json`.
- Scope: per-project, keyed by `taskId`, with `branchName`, `worktreePath`, `worktreeKey`, and `gitWorkingMode`.
- Lifecycle:
  1. Intent is registered at merge success.
  2. Push success runs cleanup and removes the intent.
  3. If process restarts before cleanup, recovery/watchdog replays the intent.

## Observability events

Worktree cleanup now emits structured orchestrator events:

- `worktree.cleanup_intent_registered`
- `worktree.cleanup_succeeded`
- `worktree.cleanup_failed`

Each event includes a `trigger` field (`merge_success`, `merge_success_push`, `recovery_replay`, `stale_inactive_ttl`) and key context (`worktreeKey`, `worktreePath`, `branchName`).
