# Self-Improvement Code Review Setting

## Overview

Add a project-level **Self-improvement** code review setting that optionally runs a codebase-wide review at a configurable frequency. When enabled and due, the system checks whether the code has changed since the last self-improvement run; if so, it triggers a Reviewer (or equivalent agent) to analyze the codebase using the project's configured code review lenses and to create improvement tasks (tickets) in the task store. This creates a feedback loop that turns review findings into actionable work without requiring manual triage.

**Scope:** One new setting (frequency dropdown: never, after each Plan, daily, weekly), persistence of "last run" state, change-detection logic (e.g. git-based), invocation of the review agent with the existing review lenses, and creation of improvement tasks from the agent output. No change to the existing per-task code review flow.

**Important:** "After each Plan" means when **plan execution is fully complete** — i.e. all tasks for that plan are done and the plan's work is fully merged into the base branch — **not** when the user clicks "Execute" in the plan UI. The self-improvement run happens once per completed plan execution, not at the start of execution.

## Acceptance Criteria

- [ ] Project settings expose a **Self-improvement** section with a single dropdown: **Frequency** with values: **Never**, **After each Plan**, **Daily**, **Weekly**.
- [ ] When frequency is **Never**, no self-improvement runs occur.
- [ ] When frequency is **After each Plan**, a self-improvement check runs **once after plan execution is fully complete** (all tasks for that plan finished and merged into the base branch). It does **not** run when the user clicks "Execute" in the plan UI. If there are code changes since the last self-improvement run, a review is triggered.
- [ ] When frequency is **Daily** or **Weekly**, a scheduled job (or equivalent) runs at the configured cadence; if the codebase has changed since the last self-improvement run, a review is triggered.
- [ ] "Code has changed" is defined as: commits or file changes in the project repo since the timestamp of the last self-improvement run (or since project creation if never run). Implementation may use git history (e.g. `git log --since`) or a stored commit SHA comparison.
- [ ] The review runs using the project's existing **code review lenses** (review angles). When lenses are configured, one review run per lens (parallel where supported) produces findings; when no lenses are configured, one general review runs (aligned with existing multi-angle review behavior).
- [ ] The reviewing agent (Reviewer or dedicated self-improvement agent) receives context for the full codebase (or diff since last run) and a prompt that instructs it to output **improvement tasks**. The system parses this output and creates tasks via `TaskStoreService.create()` (or equivalent) with a clear source (e.g. `source: 'self-improvement'`) and optional link to the plan/run that triggered them.
- [ ] Last self-improvement run timestamp (and optionally commit SHA) is persisted per project and updated after each successful run.
- [ ] Users can see that a self-improvement run is in progress (e.g. execute status or dedicated indicator) and can see created improvement tasks in the task list.

## Technical Approach

- **Settings storage:** Add `selfImprovementFrequency?: 'never' | 'after_each_plan' | 'daily' | 'weekly'` to project settings (e.g. `ProjectSettings`). Add `selfImprovementLastRunAt?: string` (ISO timestamp) and optionally `selfImprovementLastCommitSha?: string` for change detection.
- **Change detection:** Before triggering a run, compare current repo state to `selfImprovementLastRunAt` / `selfImprovementLastCommitSha`. If frequency is after_each_plan, "changes" can be defined as "any new commits on the plan's branch (or main) since last run." For daily/weekly, use git log or working tree diff since last run timestamp.
- **Trigger points:** (1) **After each Plan:** Hook into the **plan execution completion** flow — i.e. when all tasks for a plan are done and the plan's work has been merged into the base branch (e.g. after the final merge and cleanup for that plan). Do **not** trigger when the user clicks "Execute"; trigger only when that execution run has fully finished (all tasks completed and merged). After that completion, if frequency is `after_each_plan`, run change detection and conditionally trigger self-improvement. (2) **Daily/Weekly:** Use a scheduler (e.g. in-process cron, or backend job) that runs at midnight UTC for daily and once per week for weekly; for each project with that frequency, run change detection and conditionally trigger.
- **Review execution:** Reuse the existing Reviewer spawn pipeline (or equivalent) with a dedicated self-improvement prompt. Input: codebase context (or diff since last run), SPEC.md, and the list of review angles. Prompt instructs the agent to produce a structured list of improvement items; the backend parses the response (e.g. markdown list or JSON block) and creates tasks with titles and optional descriptions, setting a consistent `source` and optional `planId`/`runId` for traceability.
- **Task creation:** For each improvement item, call `TaskStoreService.create()` with appropriate fields (title, description, status, priority, optional parent or label indicating self-improvement). No automatic assignment to a plan unless product decision is to link them to a "backlog" or current plan.
- **Idempotency / concurrency:** Only one self-improvement run per project at a time; skip or queue if a run is already in progress.

## Dependencies

- Existing **Reviewer** (or equivalent) agent and spawn pipeline; ability to invoke with a custom prompt and codebase-wide context.
- Existing **code review lenses** (review angles) configuration in project settings.
- **TaskStoreService** for creating improvement tasks.
- **Git** integration for change detection (commit history or diff).
- **Plan execution completion** — a hook or event that fires when a plan's execution run is fully complete (all tasks done, work merged to base branch), **not** on Execute button click. Used for "after each Plan" trigger.
- Optional: shared scheduler or cron abstraction if not already present for daily/weekly.

## Data Model Changes

- **ProjectSettings:**
  - `selfImprovementFrequency?: 'never' | 'after_each_plan' | 'daily' | 'weekly'`
  - `selfImprovementLastRunAt?: string` (ISO 8601)
  - `selfImprovementLastCommitSha?: string` (optional, for robust change detection)
- **Tasks:** Optional field or metadata to mark tasks created by self-improvement (e.g. `source: 'self-improvement'`, or a tag/label). If the task model supports a generic "source" or "origin" field, use it; otherwise extend the schema or store in existing extensible metadata.
- No new tables required if the above fit into existing project and task storage.

## API Specification

- **GET/PUT `/projects/:id/settings`** — Include `selfImprovementFrequency`, `selfImprovementLastRunAt`, and `selfImprovementLastCommitSha` in the response and request body. PUT accepts `selfImprovementFrequency`; backend may update `selfImprovementLastRunAt` / `selfImprovementLastCommitSha` only internally after a run.
- **GET `/projects/:id/execute/status`** (or equivalent) — When a self-improvement run is in progress, include it in the status payload (e.g. `selfImprovementRunInProgress: true` or an `activeSelfImprovementRunId`) so the UI can show a busy state.
- Optional: **GET `/projects/:id/self-improvement/history`** — List of recent self-improvement runs (timestamp, status, tasks created count) for debugging and transparency. If not in scope for v1, defer.
- No new WebSocket events strictly required; existing `execute.status` or `task.updated` can signal new tasks. Optional: `self_improvement.started` / `self_improvement.completed` for clearer UI feedback.

## UI/UX Requirements

- **Location:** Project Settings, in a **Code review** or **Self-improvement** section (grouped with existing code review settings such as review angles).
- **Control:** Single dropdown labeled **Self-improvement frequency** with options: **Never**, **After each Plan**, **Daily**, **Weekly**. Default: **Never**.
- **Help text:** Short explanation: e.g. "When the codebase has changed since the last run, a review runs using your code review lenses and creates improvement tasks." For "After each Plan", clarify: "Runs once after a plan's execution is fully complete (all tasks done and merged), not when you click Execute."
- **Read-only feedback (optional):** Display "Last run: <date>" and "Next run: <date>" when frequency is daily/weekly, and "Last run: <date>" for after each Plan, if backend exposes this.
- **Task list:** Improvement tasks appear in the existing task list; they should be distinguishable (e.g. badge or filter "Self-improvement") so users can triage and prioritize.
- **Run indicator:** When a self-improvement run is in progress, show a non-blocking indicator (e.g. in execute/status area or settings) so users understand why new tasks might appear.

## Mockups

(No ASCII wireframes required for this setting-only feature; UI is a single dropdown in Project Settings and optional status text. Task list reuses existing task list with optional badge.)

## Edge Cases and Error Handling

- **No changes since last run:** Do not spawn the Reviewer; do not update `selfImprovementLastRunAt`. No tasks created.
- **Reviewer failure or timeout:** Treat as a failed run; do not update `selfImprovementLastRunAt`. Optionally retry once or surface a warning in UI/status. Log for debugging.
- **Agent output not parseable:** If the agent does not return a well-formed list of improvements, create a single fallback task (e.g. "Self-improvement review failed to parse — please review agent output") or skip task creation and log. Do not crash the flow.
- **Concurrent runs:** Guard so only one self-improvement run per project is active; subsequent triggers (e.g. two plans finishing close together) skip or queue.
- **First run:** When `selfImprovementLastRunAt` is missing, consider "changed" true so the first eligible trigger runs the review.
- **Empty repo or no git:** If change detection cannot be performed (e.g. no commits), either skip the run or treat as "changed" and run once; document behavior and optionally show a warning in UI.
- **Daily/Weekly clock skew:** Use server UTC for schedule; document that "daily" is once per calendar day and "weekly" once per week (e.g. Sunday midnight UTC) to avoid ambiguity.

## Testing Strategy

- **Unit:** (1) Change detection: given last run timestamp and commit SHA, assert "changed" / "unchanged" for various git histories. (2) Parsing of agent output into task titles/descriptions and creation of tasks with correct `source` and optional plan linkage. (3) Settings validation: only allow the four frequency values; default to `never` for existing projects.
- **Integration:** (1) Trigger "after each Plan" **only when plan execution completes** (all tasks done, merged); verify that when changes exist, the Reviewer is invoked and tasks are created; when no changes, no invocation. Verify that clicking Execute alone does **not** trigger self-improvement. (2) For daily/weekly, mock the scheduler and assert that at the right time, change detection runs and conditionally triggers the review. (3) Verify only one run per project at a time when multiple triggers fire.
- **E2E (optional):** User sets frequency to "After each Plan," runs a plan to completion (all tasks done and merged), and sees new improvement tasks in the task list and optional "Last run" in settings. Confirm that clicking Execute without completing the plan does not trigger self-improvement.

## Estimated Complexity

**Medium.** The feature reuses existing Reviewer and task infrastructure but adds: (1) new settings and persistence, (2) two trigger paths (plan-completion hook + scheduler), (3) change-detection logic with git, (4) output parsing and task creation contract, and (5) UI for dropdown and optional status. The main risks are scheduler reliability for daily/weekly and robust parsing of agent output; both are manageable with clear contracts and fallbacks. The "after each Plan" trigger must be wired to plan execution completion (all tasks done, merged), not to the Execute button.
