# Merger agent — verification checklist

Open Sprint runs `git rebase --continue` (or completes the merge) **after** the merger agent exits. The backend **skips** `rebase --continue` when the index still has unmerged paths, so unresolved conflicts surface as structured diagnostics instead of a generic git command failure.

## Before exiting with success

1. `git diff --name-only --diff-filter=U` — must be empty.
2. `git status --short` — no unmerged entries (`UU`, `AA`, `DD`, etc.).
3. `git diff --check` and `git diff --cached --check` — no conflict markers (the backend runs the latter after staging).
4. Stage all resolved paths (`git add` as needed).

## Do not run

- `git rebase --continue`, `git commit`, `git merge --continue` (orchestrator-owned).
- Destructive cleanup (`rm -rf`, `git clean -fdx`, etc.).

The live merger prompt is assembled in `packages/backend/src/services/agent/agent-merger-support.ts`; keep this file aligned with that behavior when changing the contract.
