# Beads Database Sync — Architectural Fix

## Problem Summary

Agents frequently crash with:

```
AppError: Beads command failed after sync retry: bd --no-daemon show opensprint.dev-0jmc.5 --json
{
  "error": "Database out of sync with JSONL. Run 'bd sync --import-only' to fix.
  The JSONL file has been updated (e.g., after 'git pull') but the database
  hasn't been imported yet."
}
```

This happens during `buildContext` → `beads.show()` in the coding phase.

## Root Cause Analysis

### 1. One-shot sync is insufficient

The current design runs `syncImport` **once per repo per backend process** (via `syncEnsuredRepos`). After that, no sync runs again.

The JSONL can be updated **after** the first sync by:

- `git pull` (brings new `.beads/issues.jsonl` from remote)
- Another task’s `bd export` or `bd sync` in the commit queue
- Concurrent work (multiple tasks, merge flows, etc.)
- External processes (agents, manual `bd` usage)

### 2. `syncImport` swallows errors

In `syncImport()`:

- Primary `bd sync --import-only` is tried; on failure, it catches and logs
- Fallback `bd import -i .beads/issues.jsonl --orphan-handling allow` is tried; on failure, it also catches and logs
- Neither path throws

Result: when **both** commands fail, `syncImport` returns without fixing anything. The caller retries the original command, which fails again with the same stale error. The user sees “failed after sync retry”, but the sync never actually succeeded.

### 3. No detection of external JSONL updates

There is no way to know whether JSONL changed since the last sync. The backend assumes “sync once per process” is enough, which is wrong when JSONL is updated externally.

## Proposed Architecture

### Pillar 1: Mtime-based sync invalidation

Replace “sync once per repo” with “sync when JSONL might have changed”:

- Track `{ lastSyncMs, jsonlMtime }` per repo (`syncStateMap`)
- Before each beads command, `ensureDaemon` runs `ensureSyncBeforeExec`, which checks `.beads/issues.jsonl` mtime vs stored `jsonlMtime`
- If JSONL mtime is newer (or we've never synced), run `syncImport` and update state
- **Mtime re-read after sync**: After a successful sync, re-read JSONL mtime and store that (not the pre-sync value). Mitigates races where JSONL is updated between our check and the sync.

Effects:

- Git pull (newer JSONL on disk) → next beads command triggers sync
- External export/sync → same behavior
- No unnecessary syncs when nothing changed (mtime stable)

### Pillar 2: `syncImport` throws on total failure

If both `sync --import-only` and `import --orphan-handling allow` fail:

- Throw `AppError` with `BEADS_SYNC_FAILED` and clear instructions
- Do not silently continue

Effects:

- No “failed after sync retry” when sync itself failed
- Clear error like “Failed to sync beads database. Run: bd sync --import-only”

### Pillar 3: Invalidate sync state on stale error

When `exec` sees a “Database out of sync” (or similar) error:

1. Remove the repo from the sync cache (`invalidateSyncState`)
2. Call `ensureSyncBeforeExec` (which runs `syncImport`; may throw `BEADS_SYNC_FAILED`)
3. Retry the command once

**Propagate `BEADS_SYNC_FAILED`**: If `syncImport` throws, the retry path must rethrow that `AppError` as-is rather than running the command and surfacing generic "command failed after sync retry". Users get sync-specific fix instructions.

Effects:

- We don’t assume “we’re already synced” after a stale error
- Ensures we always attempt a fresh sync before retry

## Implementation Summary

1. **`syncImport`**: Propagate failure when both primary and fallback fail; throw `AppError` with explicit fix instructions.
2. **Sync state**: Replace `syncEnsuredRepos: Set<string>` with `syncState: Map<string, { lastSyncMs: number; jsonlMtime: number }>`.
3. **`ensureSyncBeforeExec`**: Check `.beads/issues.jsonl` mtime vs `syncState`; if newer, run `syncImport` and update state.
4. **`exec` stale error path**: Clear sync state, call `ensureSyncBeforeExec`, retry once. Rethrow `BEADS_SYNC_FAILED` from `syncImport` if it throws.

## Entry Points

Sync is triggered via `ensureDaemon`, which runs `ensureSyncBeforeExec`. Called from:

- `exec` (used by `show`, `list`, `update`, `close`, etc.) — before each beads command
- `listAll` — has its own sync/retry path for direct JSONL read with fallback

All share the same `syncStateMap`; mtime check ensures we sync when JSONL changes regardless of which entry point runs first.

## Edge Cases

- **JSONL missing**: `getJsonlMtime` returns 0, so `needsSync` is true. `syncImport` runs; it will likely fail (both sync and import need the file). User gets `BEADS_SYNC_FAILED` with manual fix instructions. Acceptable for initial/uninitialized repos.
- **Stat fails** (permissions, etc.): `getJsonlMtime` returns 0; we run sync to stay safe.
- **Multiple backends**: Each process has its own sync state; mtime check ensures we sync when JSONL changes, regardless of which process updated it.
- **Clock skew**: Relies on mtimes; system clock skew can cause extra or missed syncs. Acceptable for this use case.
- **State growth**: `syncStateMap` persists for process lifetime with no pruning. Acceptable given typical backend lifecycle; future LRU/TTL possible if needed.
- **Throttling**: No debouncing; we sync whenever mtime indicates a change. Acceptable at current scale; add per-repo debounce if sync storms become an issue.

## Testing & Observability

- **Verify mtime invalidation**: `touch .beads/issues.jsonl` then run a beads command; should see sync run (check logs for sync/import attempts).
- **Stale error recovery**: Trigger "Database out of sync" (e.g., edit JSONL while DB is stale); expect `[beads] Stale DB detected...` then sync and retry.
- **Relevant log lines**: `[beads] sync --import-only failed...`, `[beads] Stale DB detected for ... invalidating sync and retrying`
