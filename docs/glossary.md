# OpenSprint Glossary

Orchestrator and execution concepts. See [AGENTS.md](../AGENTS.md) for workflow details.

## Core Concepts

| Term | Definition |
|------|------------|
| **Worktree** | Git worktree for a task at `.opensprint/worktrees/<task-id>/`. Equivalent to Gas Town's Hook. Survives backend restarts. |
| **Assignment** | `assignment.json` in `.opensprint/active/<task-id>/` — everything an agent needs to self-start. Enables GUPP-style crash recovery. |
| **Nudge** | Event that triggers the orchestrator loop (agent done, feedback submitted, Execute! clicked, or loop kicker tick). |
| **Loop kicker** | 60s timer that nudges when the orchestrator loop is idle. Runs inside the orchestrator. |
| **Watchdog** | 5-min health patrol (stale heartbeats, orphaned tasks, stale `.git/index.lock`). Runs in a separate `WatchdogService` (Witness pattern). |
| **Progressive backoff** | Deprioritize then block tasks after repeated failures. See PRD §9.1. |

## Recovery

| Term | Definition |
|------|------------|
| **GUPP-style** | "If work on your Hook, you must run it." Write `assignment.json` before spawn so crash recovery can re-read and re-spawn. |
| **Crash recovery** | Three scenarios on startup: no active task; PID alive (resume monitoring); PID dead (revert, comment, requeue). |
