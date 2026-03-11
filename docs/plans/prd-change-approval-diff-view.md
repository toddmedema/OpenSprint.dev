# PRD Change Approval Diff View

## Overview

When the Harmonizer (or any flow) proposes changes to the PRD (SPEC.md) and the system prompts the user to approve them via the Human Notification System, the UI will display a **diff** of the proposed changes in a GitHub/PR-review style. Users will see exactly what would be added, removed, or modified (line-by-line or section-level) before approving or rejecting, improving transparency and control. In addition, from the Sketch page's version list, users can open a diff of the **current PRD vs any previous version** (from history), so they can compare SPEC.md across versions without leaving the Sketch context.

## Acceptance Criteria

- When a human-in-the-loop request is of type "PRD/SPEC approval" (or equivalent), the approval UI shows a diff of the proposed SPEC.md changes.
- Diff is displayed in a readable format: unified or split view, with clear indicators for additions (e.g. green), deletions (e.g. red), and context lines.
- User can approve or reject the proposed changes from the same screen that shows the diff.
- For section-level proposals (if applicable), the diff is scoped to the relevant section(s) rather than the entire file when possible.
- Diff view is accessible on the same surface where the user is asked to approve (e.g. notification panel, modal, or dedicated approval page).
- **From the Sketch page:** The version list at the bottom of the Sketch page includes a **"View Diff"** button on **each** version history entry. Selecting "View Diff" opens a diff view of the current PRD (SPEC.md) vs that selected previous version so users can see what changed between that version and now.

## Technical Approach

- **Diff source:** Backend computes diff between two SPEC.md contents: for HIL approval, between current SPEC.md (from repo) and the proposed content; for version-list diff, between a selected previous version and current. Proposal content for HIL comes from the Harmonizer in the existing `hil.request` payload or from stored pending proposal keyed by request id. Previous-version content is obtained from a **snapshot store**: full SPEC.md is saved on each write, keyed by version (see Data Model).
- **Diff algorithm:** Use a line-based diff (e.g. `diff` library or `diff-match-patch`) on the server. Prefer server-side computation to keep payloads small and consistent.
- **API:** Use a **dedicated GET endpoint** for all diff use cases (no diff embedded in HIL payload):
  - **HIL approval:** `GET /projects/:id/prd/proposed-diff?requestId=<hilRequestId>` returns the diff for that approval request. The frontend calls this when the user opens the PRD-approval HIL UI.
  - **Version-list diff:** `GET /projects/:id/prd/diff?fromVersion=<versionId>` (or `fromVersion` + optional `toVersion`; omit `toVersion` for "current") returns the diff between the given version(s). The Sketch page version list calls this when the user chooses **"View Diff"** for a history entry. Version identifiers are those returned by `GET /projects/:id/prd/history` (e.g. version number or stable id per entry).
- **Frontend:** Add a reusable DiffView component (or use an existing library) that renders line numbers, +/- markers, and syntax-highlighted or plain markdown lines. Use it in (1) the HIL approval UI when the request type indicates PRD/SPEC changes, and (2) the Sketch page when the user opens a version-to-current diff from the version list (modal or inline panel) via the **"View Diff"** button.
- **Orchestrator/Harmonizer:** The flow that creates the SPEC-approval HIL request provides current and proposed SPEC content (or a reference) so the backend can generate the diff on demand via the proposed-diff endpoint. No diff is sent in the WebSocket payload.

## Dependencies

- Existing Human Notification System and `hil.request` / `hil.respond` flow.
- Harmonizer (or other component) that produces proposed SPEC.md content and triggers the approval request.
- `GET /projects/:id/prd/history` for version list and version identifiers used by the version-diff endpoint.
- SPEC.md and optional `.opensprint/spec-metadata.json` (or DB) for section-level diffing and for storing/retrieving previous-version content for version-list diff.
- No new external service dependencies; diff can be implemented with in-repo or npm diff utilities.

## Data Model Changes

- **No new database tables required for HIL diff.** Optionally extend the structure of a pending HIL request (in-memory or in assignment/notification payload) to include a reference (e.g. `requestId`) and proposal reference so the backend can look up proposed content when `GET proposed-diff?requestId=...` is called. Do not store the full diff in the payload.
- **Version-list diff:** Store **full SPEC.md snapshots** on each save, keyed by version (e.g. in existing `prd_metadata` or a dedicated snapshot store keyed by version/timestamp). The version-diff endpoint retrieves the snapshot for the requested `fromVersion` and diffs it against current SPEC.md. Add this snapshot-on-write behavior and storage if not already present. No change to the public PRD or history response schema is required.
- If section-level approval is supported later, `.opensprint/spec-metadata.json` (version, change_log) may be used to scope diffs; no schema change required for initial scope.

## API Specification

- **HIL proposed diff:** `GET /projects/:id/prd/proposed-diff?requestId=<hilRequestId>`
  - Returns `200` with body: `{ requestId: string; diff: { lines: Array<{ type: 'add'|'remove'|'context'; text: string; oldLineNumber?: number; newLineNumber?: number }>; summary?: { additions: number; deletions: number } } }`.
  - Returns `404` if the request is not found or not a PRD-approval request.
- **Version diff (Sketch version list):** `GET /projects/:id/prd/diff?fromVersion=<versionId>&toVersion=<versionId|'current'>`
  - Omit `toVersion` or set to `'current'` to compare `fromVersion` to current SPEC.md.
  - Returns `200` with body: `{ fromVersion: string; toVersion: string; diff: { lines: Array<{ type: 'add'|'remove'|'context'; text: string; oldLineNumber?: number; newLineNumber?: number }>; summary?: { additions: number; deletions: number } } }`.
  - Returns `404` if `fromVersion` (or `toVersion`) is invalid or content for that version is unavailable.
- **Response:** `hil.respond` remains unchanged; client sends approve/reject as today. No new response fields required.

## UI/UX Requirements

- **Diff presentation:** Use a monospace font and clear visual distinction for added (e.g. green background or left border), removed (e.g. red), and context lines. Line numbers on the left (old and new, or single column for unified) improve scanability.
- **HIL approval:** Primary actions "Approve" and "Reject" (or "Request changes") must be visible without scrolling away from the diff when the diff is short; for long diffs, use a sticky action bar or floating actions.
- **Sketch version list:** At the bottom of the Sketch page, the version list (from PRD history) shows **each entry with a "View Diff" button**. Selecting "View Diff" opens the same DiffView (modal or panel) with the diff from that version to current.
- **Accessibility:** Ensure keyboard navigation and screen reader support for diff content (e.g. "added line", "removed line").
- **Performance:** For very large SPEC.md, consider virtualized list or section-by-section expand/collapse so the page remains responsive.
- **Theme:** Diff colors must respect light/dark/system theme (no flash on load).

## Mockups

**HIL approval screen (with diff):**

```
+------------------------------------------+
|  PRD change approval                     |
+------------------------------------------+
|  Review proposed SPEC.md changes         |
+------------------------------------------+
| 1  - | Executive Summary                 |
| 2  - | OpenSprint is a web application…  |
| 3  + | OpenSprint is a web application   |
| 4  + | that guides users through the…    |
| 5    | ...                               |
+------------------------------------------+
|  [Approve]  [Reject]                     |
+------------------------------------------+
```

**Sketch page — version list with "View Diff" per entry:**

```
+------------------------------------------+
|  Sketch  |  SPEC.md content...           |
+------------------------------------------+
|  ...                                     |
+------------------------------------------+
|  Version history                         |
|  v3  Mar 9, 2026  sketch   [View Diff]   |
|  v2  Mar 8, 2026  plan     [View Diff]   |
|  v1  Mar 7, 2026  sketch   [View Diff]   |
+------------------------------------------+
```

**Version diff modal (opened from "View Diff"):**

```
+------------------------------------------+
|  Diff: v2 → current                      |
+------------------------------------------+
| 1  - | (v2 content line)                 |
| 2  + | (current content line)            |
| ...                                      |
+------------------------------------------+
|  [Close]                                  |
+------------------------------------------+
```

## Edge Cases and Error Handling

- **Empty or identical content:** If proposed and current are the same (or fromVersion equals current), show a message like "No changes" and still allow "Approve" (no-op) or "Dismiss" / "Close"; do not require Approve for version-list view.
- **Very large SPEC:** Cap or paginate diff (e.g. first N lines + "Show more") or switch to section-only view to avoid UI lockup and huge payloads.
- **Stale proposal:** If SPEC.md was changed after the proposal was created (e.g. by another tab or process), show a warning that the base has changed and optionally refresh the diff or prompt the user to re-request.
- **Missing proposal:** If `requestId` is invalid or proposal data is missing, return 404 and show an error message in the UI with option to dismiss the notification.
- **Missing version for version-list diff:** If `fromVersion` is invalid or that version's content is not stored, return 404 and show an error in the UI with option to close the diff view.
- **Concurrent HIL requests:** Only one PRD-approval diff view is tied to a given request; multiple simultaneous requests are handled by the existing HIL queue/UI.

## Testing Strategy

- **Unit (backend):** Diff generation from two strings (additions only, deletions only, mixed, empty, large input); section-scoped diff if implemented. Version lookup returns correct snapshot or 404.
- **Unit (frontend):** DiffView component renders lines correctly for add/remove/context; theme switching updates colors.
- **Integration:** `GET /projects/:id/prd/proposed-diff?requestId=...` with valid `requestId` returns correct diff; invalid `requestId` returns 404. `GET /projects/:id/prd/diff?fromVersion=...` with valid version returns correct diff; invalid version returns 404.
- **E2E:** (1) With a pending PRD approval HIL, open the approval UI, verify diff is visible and matches expected changes, approve and confirm request is resolved. (2) On Sketch page, open version list, choose **"View Diff"** for a previous version, verify diff opens and shows that version vs current.
- **Regression:** Existing HIL flows (non-PRD) remain unchanged and do not show a diff block.

## Estimated Complexity

**Medium.** The feature reuses the existing HIL pipeline and SPEC.md storage. Main work: diff computation on the backend, two GET endpoints (proposed-diff, diff), reusable DiffView component, and integration into the HIL approval screen and the Sketch page version list (with a **"View Diff"** button on each version entry). Section-level diffing and virtualization for very large files can be deferred to keep initial scope manageable. Version-list diff uses a **snapshot store**: on each SPEC write, save full SPEC.md content keyed by version; add this storage if not already present.
