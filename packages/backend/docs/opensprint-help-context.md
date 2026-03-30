# Open Sprint Internal Documentation

This document provides context for the Help Chat agent to answer questions about Open Sprint's scheduling, configuration, orchestrator logic, and task runnability.

---

## Agent Instructions (AGENTS.md)

Task tracking is handled internally by `TaskStoreService` backed by **SQLite (default)** or **PostgreSQL**. The connection URL is resolved in order: `DATABASE_URL`, then `databaseUrl` in `~/.opensprint/global-settings.json`, then the default SQLite path (`~/.opensprint/data/opensprint.sqlite`). There is no external CLI for task management.

**Integration token encryption:** Without `INTEGRATION_ENCRYPTION_KEY` (base64-encoded 32-byte key), integration OAuth tokens are encrypted using a key derived from the hostname and `~/.opensprint/encryption-salt`. That fallback is intended for casual single-user local use. For **shared or multi-user servers**, or any host where other OS users might read `~/.opensprint`, operators **must** set `INTEGRATION_ENCRYPTION_KEY`. The backend logs a startup warning when the variable is unset.

**Global agent defaults:** `~/.opensprint/global-settings.json` may include `simpleComplexityAgent` and `complexComplexityAgent` (same shape as project settings: `type`, `model`, `cliCommand`, optional `baseUrl` for local providers). They are read and written via `GET`/`PUT /api/v1/global-settings`. When a project’s entry in `~/.opensprint/settings.json` does not define those tiers (neither the current nor legacy key names), effective project settings use the global defaults for that tier. New projects seeded on first `getSettings` also inherit global defaults when set. Defaults match `DEFAULT_AGENT_CONFIG` in `@opensprint/shared` (`cursor`, `model: null`, `cliCommand: null`) when neither global nor project defines a tier.

**Project Overview:** Open Sprint is a web application that guides users through the full software development lifecycle using AI agents. It has five phases — SPEED: Sketch, Plan, Execute, Evaluate, and Deliver.

**Tech stack:** Node.js + TypeScript (backend), React + TypeScript (frontend).

**Windows runtime policy:** Open Sprint is supported on Windows only when `npm run setup` and `npm run dev` are run inside WSL2. Project repos must live in the WSL filesystem (for example `/home/<user>/src/app`), not under `/mnt/c/...`. Native Windows execution is unsupported because orchestration and process-management paths assume Linux/Unix shell and process semantics.

### Execute Agent Contract

- Execute agents start in a prepared worktree with the task branch already checked out.
- They run the smallest relevant non-watch verification for touched workspaces while iterating, using scoped tests first and scoped build/typecheck and lint commands when the change could affect them, and they leave the branch in a state where the project’s configured merge quality gates are expected to pass before reporting success.
- If they add or change package dependencies, they run the project’s install from the repository root, update lockfiles, and commit manifest and lockfile changes with the code that uses those packages.
- If tests are included in the build/typecheck, they ensure test-runner globals and typing/runtime configuration are set so build/typecheck still passes.
- They report completion or blocking questions by writing the exact `result.json` payload requested in the task prompt.
- They should commit incremental logical units while working so crash recovery can preserve progress.
- They must not push, merge, or close tasks manually; the orchestrator handles validation, task state, merging, and remote publication.

### Orchestrator Recovery (GUPP-style)

Work state is persisted before agent spawn via `assignment.json` in `.opensprint/active/<task-id>/`. If the backend crashes, recovery reads the assignment and re-spawns or resumes the agent. **Always write assignment before spawn; never spawn then write.**

### Loop Kicker vs Watchdog

- **Loop kicker** (60s): Restarts the orchestrator loop when idle. Runs inside the orchestrator.
- **Watchdog** (5 min): Witness-style health patrol — stale heartbeats, orphaned tasks, stale `.git/index.lock`. Runs in a separate `WatchdogService`.

### Task Store

Schema is applied on init via `runSchema` in `packages/backend/src/db/schema.ts`. Backend tests use a separate test database (`opensprint_test` or `TEST_DATABASE_URL`). The `TaskStoreService` provides:

- `create()` / `createMany()` — Create tasks with optional parent IDs
- `update()` / `updateMany()` — Update task fields (status, assignee, priority, etc.)
- `close()` / `closeMany()` — Close tasks with a reason
- `show()` — Get a single task by ID
- `listAll()` — List all tasks
- `ready()` — Get priority-sorted tasks with all blockers resolved
- `addDependency()` — Add dependency between tasks (blocks, parent-child, etc.)

### Task ID Format

- `os-xxxx` — Top-level task (random hex)
- `os-xxxx.1` — Child task under parent
- `os-xxxx.1.1` — Sub-task

### Epic Status and Task Runnability

- Epics can be `blocked` (plan not approved), `open` (approved), or `closed` (complete).
- When an epic has `status: "blocked"`, all its child tasks are **excluded from `ready()`** and show "Planning" in the kanban.
- When the user clicks "Execute!", the orchestrator sets the epic to `status: "open"` via `TaskStoreService.update`, making child tasks eligible for execution.
- Tasks in `ready()` must have: status=`open`, not an epic, and all `blocks` dependencies closed. Tasks whose epic is blocked are excluded.

### Plan versioning

- When the user (or planner agent) updates a plan's markdown: if the **current plan version has no tasks yet**, the backend **updates that version in place**. If the current version **already has one or more tasks**, the backend **creates a new plan version** for the update. The planner does not need to choose; the backend applies this rule on each save.

### Protected Path Policy

Certain file paths are sensitive surfaces (integration, OAuth, token handling) and must only be modified when the task explicitly scopes integration or OAuth work. Execute agents refuse to modify these paths for non-integration tasks, and reviewers flag violations. Protected patterns: `routes/integrations-*`, `integration-store`, `token-encryption`, `routes/oauth`, `todoist-sync`. Scope keywords that unlock: integration, oauth, todoist, token-encrypt, api-key-stor, third-party-auth, external-service, connect(ion)-service.

---

## Glossary (docs/glossary.md)

| Term                    | Definition                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Worktree**            | Git worktree for a task at `.opensprint/worktrees/<task-id>/`. Survives backend restarts.                                          |
| **Assignment**          | `assignment.json` in `.opensprint/active/<task-id>/` — everything an agent needs to self-start. Enables GUPP-style crash recovery. |
| **Nudge**               | Event that triggers the orchestrator loop (agent done, feedback submitted, Execute! clicked, or loop kicker tick).                 |
| **Loop kicker**         | 60s timer that nudges when the orchestrator loop is idle. Runs inside the orchestrator.                                            |
| **Watchdog**            | 5-min health patrol (stale heartbeats, orphaned tasks, stale `.git/index.lock`). Runs in a separate `WatchdogService`.             |
| **Progressive backoff** | Deprioritize then block tasks after repeated failures.                                                                             |

---

## Orchestrator and Scheduling (PRD §5)

### Architecture

- **One orchestrator per project**, always running. When the backend starts, it launches an orchestrator for each registered project.
- **Slot-based execution:** Each project can run multiple Coder agents in parallel when `maxConcurrentCoders > 1` and file scopes do not overlap. Review can also fan out into angle-specific reviewers.
- **Event-driven with watchdog:** The orchestrator triggers agents on events. A watchdog runs every 5 minutes to catch edge cases: checks stale heartbeats, orphaned tasks, stale `.git/index.lock`, and other recovery paths.

### Task Store and `ready()`

- `TaskStoreService.ready()` finds tasks with no open blockers, sorted by priority. This is the execution queue.
- Tasks excluded from `ready()`: epics, tasks with `status: "blocked"`, tasks whose epic has `status: "blocked"`, and tasks with unresolved `blocks` dependencies.
- The orchestrator uses `TaskStoreService.update(id, { assignee: ... })` to track which agent is working on a task.

### Parallel Coders (`maxConcurrentCoders`)

When `maxConcurrentCoders > 1`, the **TaskScheduler** selects non-overlapping tasks for parallel execution:

1. **File Scope Analyzer** — predicts which files a task will touch from planner `files` metadata, dependency history, or heuristics.
2. **Conflict-Aware Scheduler** — selects up to `maxSlots` tasks whose predicted scopes do not overlap.
3. **Dispatch loop** — fills available coder slots in the current pass unless an explicit `OPENSPRINT_MAX_NEW_TASKS_PER_LOOP` override lowers the cap.

**Why only one coder might be active:** Even with `maxConcurrentCoders > 1`, Open Sprint may still run one coder if all ready tasks overlap, only one task is ready, the project is in `gitWorkingMode: "branches"`, or the selected provider is exhausted.

---

## Configuration

- **Agent config:** Project Settings → Agent Config. Planning Agent Slot (Dreamer, Planner, etc.) and Coding Agent Slot (Coder, Reviewer) are configured separately.
- **`maxConcurrentCoders`:** Project setting. Default `1`. When greater than `1`, parallel coders can run if no file overlap blocks them.
- **`maxTotalConcurrentAgents`:** Optional project setting. When set, caps all overlapping agent work (planning calls, coders, reviewers, merger) for that project so you can respect provider concurrency limits. When unset, there is no global cap beyond `maxConcurrentCoders` for execute. Enabling the cap in settings defaults to `10` (or higher if `maxConcurrentCoders` is larger). Bulk “Generate all tasks” in Plan uses up to `10` parallel requests when this setting is unset.
- **`gitWorkingMode`:** `"worktree"` (default) or `"branches"`. Branches mode forces `maxConcurrentCoders` to `1`.
- **`unknownScopeStrategy`:** `"conservative"` or `"optimistic"` for tasks whose file scope is only heuristic.
