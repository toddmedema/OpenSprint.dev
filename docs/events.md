# Event Log Schema

Events are appended to `.opensprint/events.jsonl` for audit and crash recovery. Each line is a JSON object.

## OrchestratorEvent

```typescript
interface OrchestratorEvent {
  timestamp: string;   // ISO 8601
  projectId: string;
  taskId: string;
  event: string;      // event type (see below)
  data?: Record<string, unknown>;
}
```

## Event Types

### Orchestrator transitions

| Event | When | data |
|-------|------|------|
| `transition.start_task` | Task assigned to Coder | `attempt` |
| `transition.enter_review` | Tests passed, Reviewer triggered | `attempt` |
| `transition.complete` | Reviewer approved, task done | `attempt` |
| `transition.fail` | Task failed, reverted, requeued | `attempt` |

### Agent lifecycle

| Event | When | data |
|-------|------|------|
| `agent.spawned` | Agent process started | `phase`, `model`, `attempt` |
| `task.completed` | Task merged and closed | — |
| `task.failed` | Task failed (revert, requeue) | `failureType`, `attempt`, `reason` |

### Git / push

| Event | When | data |
|-------|------|------|
| `push.succeeded` | Push to remote completed | — |

### Watchdog (Witness pattern)

| Event | When | data |
|-------|------|------|
| `watchdog.stale_heartbeat` | Agent heartbeat too old | `staleSec`, `threshold` |
| `watchdog.orphan_recovery` | Orphaned tasks recovered | `recovered` (task IDs) |
| `watchdog.stale_lock_removed` | Stale `.git/index.lock` removed | `ageMs` |

### Deployment

| Event | When | data |
|-------|------|------|
| `build.completed` | EAS build finished | — |

## Querying

- `eventLogService.readSince(repoPath, since)` — events after timestamp
- `eventLogService.readForTask(repoPath, taskId)` — events for a task
- `eventLogService.readRecent(repoPath, count)` — last N events (crash recovery)
