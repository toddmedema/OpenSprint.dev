# Event Log Schema

Events are appended to `.opensprint/events.jsonl` for audit and crash recovery. Each line is a JSON object.

## OrchestratorEvent

```typescript
interface OrchestratorEvent {
  timestamp: string; // ISO 8601
  projectId: string;
  taskId: string;
  event: string; // event type (see below)
  data?: Record<string, unknown>;
}
```

## Event Types

### Orchestrator transitions

| Event                     | When                             | data      |
| ------------------------- | -------------------------------- | --------- |
| `transition.start_task`   | Task assigned to Coder           | `attempt` |
| `transition.enter_review` | Tests passed, Reviewer triggered | `attempt` |
| `transition.complete`     | Reviewer approved, task done     | `attempt` |
| `transition.fail`         | Task failed, reverted, requeued  | `attempt` |

### Agent lifecycle

| Event            | When                          | data                               |
| ---------------- | ----------------------------- | ---------------------------------- |
| `agent.spawned`  | Agent process started         | `phase`, `model`, `attempt`        |
| `task.completed` | Task merged and closed        | —                                  |
| `task.failed`    | Task failed (revert, requeue) | `failureType`, `attempt`, `reason` |

### Git / push

| Event            | When                     | data |
| ---------------- | ------------------------ | ---- |
| `push.succeeded` | Push to remote completed | —    |

### Integrity / circuit breakers

| Event                                | When                                                                                                                                                                            | data                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `circuit_breaker.empty_diff_blocked` | Coder reported `success` but `captureBranchDiff` was empty on **N** consecutive attempts (see orchestrator `MAX_CONSECUTIVE_EMPTY_DIFFS`). Task is blocked as `coding_failure`. | `projectId`, `attempt`, `branchName`, `consecutiveEmptyDiffs`, `threshold` |

#### Runbook: `circuit_breaker.empty_diff_blocked`

- **What it means:** The orchestrator stopped retrying because the agent kept claiming success without any committed diff vs the base branch. This is **not** proof of malicious behavior; it usually indicates a bad or underspecified prompt, missing context, or the agent only changing ignored/untracked paths.
- **Integrity vs prompts:** Treat as a **workflow / prompt-quality** signal first. Escalate to an integrity review only if the same task or project shows a pattern of empty diffs alongside suspicious API or git activity elsewhere.
- **Where it is stored:** `orchestrator_events` (queried via `eventLogService.readForTask`, `readSince`, `readSinceByProjectId`, or the execute API that exposes the event log).

### Watchdog (Witness pattern)

| Event                         | When                            | data                    |
| ----------------------------- | ------------------------------- | ----------------------- |
| `watchdog.stale_heartbeat`    | Agent heartbeat too old         | `staleSec`, `threshold` |
| `watchdog.orphan_recovery`    | Orphaned tasks recovered        | `recovered` (task IDs)  |
| `watchdog.stale_lock_removed` | Stale `.git/index.lock` removed | `ageMs`                 |

### Deployment

| Event             | When               | data |
| ----------------- | ------------------ | ---- |
| `build.completed` | EAS build finished | —    |

## Querying

- `eventLogService.readSince(repoPath, since)` — events after timestamp
- `eventLogService.readForTask(repoPath, taskId)` — events for a task
- `eventLogService.readRecent(repoPath, count)` — last N events (crash recovery)
