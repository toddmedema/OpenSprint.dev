# Redux State Management Architecture — Review & Improvements

This document reviews the frontend Redux setup and recommends changes to improve page performance and reduce redundant API calls. The app is a single-page application with all phases mounted and visibility toggled via CSS, so shared state is already hoisted to the store; the focus here is on deduplication, selectors, and fetch strategy.

---

## Current Architecture Summary

- **Store**: Single `configureStore` with slices: `project`, `websocket`, `sketch`, `design`, `plan`, `execute`, `taskRegistry`, `eval`, `deliver`, `notification`.
- **Data loading**: `ProjectView` dispatches a batch of fetches on mount (project, sketch PRD/chat/history, plans, tasks, execute status, feedback, deliver status/history). Phases are mounted once; some phases also dispatch fetches in their own `useEffect`.
- **API layer**: Thunks via `createAsyncThunk`; no RTK Query (no built-in request deduplication or caching).
- **Selectors**: Inline `useAppSelector((s) => s.plan.plans)` etc.; no `createSelector` (no memoized derived state).

---

## 1. Duplicate State: Plans in Two Slices

**Issue**: Plans live in both `plan` and `execute`:

- `plan.plans` — filled by `fetchPlans` (ProjectView mount, Plan phase actions, WS `plan.updated`).
- `execute.plans` — filled only by `fetchExecutePlans` (e.g. inside `markTaskDone`), which also dispatches `setPlansAndGraph` to the plan slice.

**Evidence**: `PlanPhase` and `ExecutePhase` both read **only** from `s.plan.plans`. `execute.plans` is used only in the execute slice’s own reducers and tests.

**Recommendation**: Treat the plan slice as the single source of truth for plans.

- Remove `plans` (and optionally `dependencyGraph` if you keep it only in plan slice) from `execute` state.
- In `markTaskDone` (and any other thunk that calls the plans API), keep only the `setPlansAndGraph` dispatch; do not write plans into the execute slice.
- Remove `fetchExecutePlans`’s handling that sets `state.plans` in the execute slice (or remove the thunk and have callers use `fetchPlans` + `setPlansAndGraph` if you still need the graph in one place).
- Have Execute phase continue to use `s.plan.plans` (and plan slice’s dependency graph if applicable).

**Benefits**: One source of truth, no risk of execute and plan lists drifting, simpler mental model and fewer redundant writes.

---

## 2. Redundant API Calls

### 2.1 Deliver phase refetch on mount

**Issue**: `ProjectView` already dispatches `fetchDeliverStatus(projectId)` and `fetchDeliverHistory(projectId)` on mount. `DeliverPhase` has a `useEffect` that runs the same two fetches whenever `projectId` or `dispatch` changes. Because all phases are mounted at once, deliver data is fetched twice on initial load.

**Recommendation**: Rely on the global load in `ProjectView` for initial deliver data.

- Remove the `useEffect` in `DeliverPhase` that dispatches `fetchDeliverStatus` and `fetchDeliverHistory`. Keep dispatching these only after user/WS actions (e.g. `triggerDeliver`, `rollbackDeliver`, and in the websocket middleware on `deliver.completed`).

**Result**: One fewer duplicate request pair per project load.

### 2.2 WebSocket `task.updated` → full refetch

**Issue**: For each `task.updated` event, the websocket middleware dispatches `taskUpdated` and `mergeTaskUpdate` (incremental update) and then `fetchTasks(projectId)` (full list refetch). So every task update triggers an extra API call even though the store is already updated from the event.

**Recommendation**: Prefer incremental updates for `task.updated`.

- In the middleware, on `task.updated`, keep `taskUpdated` and `mergeTaskUpdate`; **stop** dispatching `fetchTasks(projectId)` for this event. Rely on the server event payload for UI consistency.
- Continue to dispatch `fetchTasks` only where a full refresh is appropriate: e.g. `agent.started`, `agent.completed`, and explicit user actions (e.g. after “Mark done” or when opening Execute phase if you add a “refresh” there). If the backend does not send enough data in `task.updated` for your UI, extend the event payload instead of refetching every time.

**Result**: Fewer redundant list fetches under active agent/task updates.

### 2.3 Optional: request deduplication / freshness in thunks

**Issue**: With thunks only, two components that dispatch the same fetch (e.g. two effects firing close together) can trigger two identical requests. There is no “in-flight” or “just fetched” guard.

**Recommendation** (optional): Add light deduplication or freshness so repeated dispatches don’t always hit the network.

- **Option A — Skip if loading**: In each thunk, call `getState()` and skip the API call if that slice’s `loading` is already true; optionally still dispatch a no-op or use a shared “request id” so multiple subscribers can attach to one in-flight request.
- **Option B — Stale-while-revalidate**: Add a `lastFetchedAt` (and optionally `projectId`) to slices that are loaded once per project. In the thunk, if `lastFetchedAt` is within the last N seconds (e.g. 10–30) and `projectId` matches, skip the request and do nothing (or resolve with current state). Still dispatch refetches after mutations or WS events.

Implement either in the thunk body or in a small wrapper; avoid duplicating logic in every thunk by extracting a helper (e.g. `shouldSkipFetch(slice, projectId, maxAgeMs)`).

**Result**: Fewer duplicate calls when ProjectView and a phase both run effects, or when WS and a phase both trigger the same fetch.

---

## 3. Selectors and Re-renders

**Issue**: There are no memoized selectors. Components use inline selectors like `useAppSelector((s) => s.plan.plans)` or `useAppSelector((s) => s.execute.tasks)`. Any change in that slice (e.g. `loading`, `error`, `selectedPlanId`) causes a new reference or value and re-renders every component that selects from that slice, even if the part they care about (e.g. `plans`) did not change. React-Redux uses `Object.is` for the selected value, so selecting a new array reference forces a re-render.

**Recommendation**: Introduce memoized selectors with `createSelector` (from `@reduxjs/toolkit` or `reselect`).

- **Per-slice selectors**: For each slice, add a small `selectors` file (or section) that exports:
  - Base: `selectPlanState`, `selectExecuteState`, etc.
  - Derived: `selectPlans`, `selectSelectedPlan`, `selectTasks`, `selectTaskDetail`, `selectDeliverHistory`, and so on. Use `createSelector` so that the returned value (e.g. `plans` array) is the same reference when the underlying slice state for that data has not changed.
- **Use in components**: Replace inline `useAppSelector((s) => s.plan.plans)` with `useAppSelector(selectPlans)`. For components that need several fields, either:
  - Use multiple memoized selectors (each will only trigger a re-render when its slice subset changes), or
  - One combined selector that returns a small object and is memoized so the object reference is stable when its contents are unchanged.

**Example**:

```ts
// store/selectors/planSelectors.ts
import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../index';

const selectPlanState = (s: RootState) => s.plan;

export const selectPlans = createSelector(
  [selectPlanState],
  (plan) => plan.plans
);

export const selectSelectedPlanId = createSelector(
  [selectPlanState],
  (plan) => plan.selectedPlanId
);

export const selectSelectedPlan = createSelector(
  [selectPlans, selectSelectedPlanId],
  (plans, id) => (id ? plans.find((p) => p.metadata.planId === id) ?? null : null)
);
```

**Result**: Components re-render only when the data they actually use changes, improving performance when other slice fields (loading, error, selection) update frequently.

---

## 4. Hoisting and Shared State (Already in Good Shape)

The app already follows a good SPA pattern:

- One Redux store; all phases mounted; visibility by CSS.
- ProjectView loads project-scoped data once on mount; phases read from the store.
- Shared state (project, plans, tasks, execute status, deliver, feedback) is global; no per-tab duplicate loading by design.

The main gains are from **removing duplicate state** (plans), **removing duplicate fetches** (deliver on mount, optional task.updated refetch), **optional thunk deduplication**, and **memoized selectors** to limit re-renders. No structural change to “what lives in Redux” is required for these improvements.

---

## 5. Implementation Priority

| Priority | Change | Impact |
|----------|--------|--------|
| High | Remove duplicate deliver fetch in DeliverPhase | Fewer redundant API calls on every load |
| High | Add memoized selectors for plan, execute, deliver, project | Fewer re-renders, better perf |
| Medium | Single source of truth for plans (drop execute.plans) | Simpler state, no drift |
| Medium | Stop fetchTasks on task.updated in WS middleware | Fewer API calls under load |
| Low | Thunk-level “skip if loading” or “stale within N s” | Extra safety against duplicate requests |

Implementing the high-priority items first will yield the most noticeable improvement in page performance and redundant API calls while keeping the current SPA and Redux architecture intact.
