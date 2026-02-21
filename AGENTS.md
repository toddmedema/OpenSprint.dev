# Agent Instructions — OpenSprint

This project uses **bd** (beads) for all task and issue tracking. Run `bd onboard` to get started.

## Project Overview

OpenSprint is a web application that guides users through the full software development lifecycle using AI agents. It has five phases — SPEED: Sketch, Plan, Execute, Evaluate, and Deliver. The PRD is at `PRD.md`.

**Tech stack:** Node.js + TypeScript (backend), React + TypeScript (frontend).

## Orchestrator Recovery (GUPP-style)

Work state is persisted before agent spawn via `assignment.json` in `.opensprint/active/<task-id>/`. If the backend crashes, recovery reads the assignment and re-spawns the agent — no work is lost. **Always write assignment before spawn; never spawn then write.**

## Loop Kicker vs Watchdog

- **Loop kicker** (60s): Restarts the orchestrator loop when idle. Runs inside the orchestrator.
- **Watchdog** (5 min): Witness-style health patrol — stale heartbeats, orphaned tasks, stale `.git/index.lock`. Runs in a separate `WatchdogService`.

## Beads Quick Reference

Beads removed the daemon subsystem (no `--no-daemon` flag).

```bash
bd ready                          # Find next available work (priority-sorted, all deps resolved)
bd show <id>                      # View issue details and audit trail
bd update <id> --claim            # Atomically claim a task (sets assignee + in_progress)
bd close <id> --reason "..."      # Mark work done
bd create "Title" -t <type> -p <priority>  # Create an issue (types: bug/feature/task/epic/chore)
bd dep add <child> <parent>       # Add dependency (blocks, related, parent-child)
bd list --json                    # List all issues with JSON output
bd sync                           # Sync with git
```

## Task Workflow

1. Run `bd ready` to find the next task to work on
2. Claim the task with `bd update <id> --claim`
3. Create a feature branch: `git checkout -b opensprint/<task-id>`
4. Implement the task, write tests — **commit incrementally** during work (crash resilience)
5. Close the task: `bd close <id> --reason "Implemented and tested"`
6. Run `bd sync` after closing
7. **Before pushing:** squash all branch commits into one that includes both code changes and `.beads/issues.jsonl` (closed task)

## Issue Hierarchy

Beads supports hierarchical IDs for organizing work:

- `opensprint.dev-xxxx` — Epic (feature-level)
- `opensprint.dev-xxxx.0` — Gating task (plan approval gate)
- `opensprint.dev-xxxx.1` — Task under that epic
- `opensprint.dev-xxxx.1.1` — Sub-task

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST finish ALL steps below. Work is NOT done until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** — Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) — Tests, linters, builds
3. **Update issue status** — Close finished work, update in-progress items
4. **PUSH TO REMOTE** — This is MANDATORY. Push directly to `origin/main` (no PRs):
   ```bash
   git fetch origin
   git rebase origin/main
   bd close <task-id> --reason "Implemented and tested"   # if not already closed
   bd sync
   git add .beads/issues.jsonl
   git reset --soft origin/main
   git commit -m "Implement X (closes <task-id>)"
   git checkout main
   git pull --rebase origin main
   git merge opensprint/<task-id>
   git push origin main
   git branch -d opensprint/<task-id>
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** — Clear stashes, prune remote branches
6. **Verify** — All changes committed AND pushed
7. **Hand off** — Provide context for next session

**CRITICAL RULES:**

- One commit on main per task (code + beads). Push directly to `origin/main` — no PRs
- Work is NOT done until `git push` succeeds
- NEVER stop before pushing — that leaves work stranded locally
- NEVER say "ready to push when you are" — YOU must push
- If push fails, resolve and retry until it succeeds
- Always use `--json` flags when programmatically parsing bd output
