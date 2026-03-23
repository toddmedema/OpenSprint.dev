# Frontend State And Realtime

This document describes the current frontend ownership model after the URL-routing cleanup.

## State Ownership

- React Query is the durable cache for server-backed resources such as projects, PRD data, plans, tasks, feedback, deliver status/history, active agents, and notifications.
- URL search params are the canonical source for shareable detail state:
  - `plan`
  - `task`
  - `feedback`
  - `question`
  - `section`
- Redux is reserved for runtime/UI concerns:
  - websocket connection state
  - connection-error banner state
  - unread phase flags
  - transient live agent/auditor output buffers
  - deliver live logs and toasts
  - a shrinking set of phase-local async/UI helpers during the migration away from snapshot mirroring

## Routing Notes

- `routeSlice` has been removed. Code that needs to know the active project phase should read the router directly instead of relying on a Redux mirror.
- `ProjectView` owns plan/task/feedback detail selection from the URL and passes those IDs down through props.
- Non-shareable UI state stays local to the phase/component:
  - filters
  - search text
  - drafts
  - panel expansion
  - scroll position

## Realtime Flow

- Project websocket lifecycle is still initiated from the project shell and homepage navbar.
- Server events currently fan out through the websocket middleware:
  - Query-backed resources are invalidated or patched in the query cache.
  - Runtime-only UI state is updated in Redux.
  - Unread-phase decisions compare the incoming event against the current router pathname, not Redux.
- Live agent output remains in Redux because it is append-heavy, transient, and shared across Execute and Agent Dashboard views.

## Migration Status

- Deliver no longer mirrors query data into Redux snapshots.
- Navbar notification and active-agent dropdowns read directly from React Query.
- Sketch, Plan, Execute, and Evaluate still contain some Redux-backed server snapshots and are being migrated incrementally.
