# OpenSprint — PRD vs Implementation Gap Analysis

**Date:** February 15, 2026  
**PRD Version:** 1.7

This document compares the current implementation against the PRD and outlines missing or incomplete functionality.

---

## Summary

| Area            | Status             | Notes                                                     |
| --------------- | ------------------ | --------------------------------------------------------- |
| Project Setup   | ✅ Mostly complete | Git + beads init, agent config, HIL, deployment           |
| Home Screen     | ⚠️ Partial         | Missing project dropdown selector                         |
| Design Phase    | ⚠️ Partial         | Missing PRD click-to-focus, direct edit, history          |
| Plan Phase      | ⚠️ Partial         | Missing AI decomposition, Add Plan flow, dependency graph |
| Build Phase     | ✅ Mostly complete | Orchestrator, kanban, agent output; minor gaps            |
| Validate Phase  | ✅ Mostly complete | Feedback submission, AI mapping                           |
| Living PRD Sync | ❌ Missing         | No PRD updates on Ship or scope-change feedback           |
| HIL             | ⚠️ Partial         | Backend exists; WebSocket forwarding incomplete           |
| Deployment      | ⚠️ Stub            | Config stored; no Expo/custom pipeline execution          |

---

## 1. Project Setup & Configuration

### 1.1 Implemented ✅

- Project name, description, repo path
- Agent configuration (planning + coding, Claude/Cursor/Custom)
- Model selection dropdown (Claude, Cursor)
- Deployment mode selection (Expo, Custom)
- Human-in-the-loop preferences (4 categories, 3 modes)
- Git init + `bd init` on project creation
- `.opensprint/` directory structure
- Initial PRD with empty sections
- Settings persisted to `.opensprint/settings.json`
- Global project index at `~/.opensprint/projects.json`
- Folder browser for repo path selection

### 1.2 Missing / Incomplete

| Item                      | PRD Reference         | Notes                                                                                          |
| ------------------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| Custom CLI command input  | §6.3                  | When "Custom" agent is selected, user must provide CLI command. No UI field for this in setup. |
| Test framework detection  | §10.2 ProjectSettings | `testFramework` is stored as null; no detection or user selection during setup.                |
| Expo account / EAS config | §6.4                  | Expo mode is selectable but no EAS Build config or deployment execution.                       |

---

## 2. Home Screen & Project Management

### 2.1 Implemented ✅

- Project cards with name, current phase, last-modified date
- "Create New Project" button
- Empty state when no projects
- Link to project view

### 2.2 Missing / Incomplete

| Item                          | PRD Reference | Notes                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project dropdown selector** | §6.1          | "Once inside a project, the project name appears at the top-left of the navbar and functions as a dropdown selector. Clicking it reveals a list of all projects, allowing the user to rapidly switch between projects without returning to the home screen." Currently the project name is a non-interactive button. |
| Overall progress on cards     | §6.1          | Cards show phase but not "overall progress" (e.g., X% complete).                                                                                                                                                                                                                                                     |

---

## 3. Design Phase

### 3.1 Implemented ✅

- Split-pane: chat (left) + live PRD (right)
- Conversational PRD creation via planning agent
- PRD_UPDATE parsing and section updates
- Living PRD display (sections rendered as markdown)
- Conversation history load/save
- Clear chat
- WebSocket broadcast of `prd.updated`

### 3.2 Missing / Incomplete

| Item                                        | PRD Reference | Notes                                                                                                                              |
| ------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Click PRD section to focus conversation** | §7.1.5        | "Users can click on any section of the PRD to focus the conversation on that area." Not implemented.                               |
| **Direct PRD editing**                      | §7.1.5        | "or edit the PRD directly with changes reflected back into the conversation context." No inline edit UI.                           |
| **PRD change history**                      | §7.1.2, §11.1 | `GET /projects/:id/prd/history` exists in API but no UI to "view the full change history and understand why each change was made." |
| Mockup generation                           | §7.1.2        | "The AI generates UI mockups or wireframes" — not in scope for current chat flow.                                                  |

---

## 4. Plan Phase

### 4.1 Implemented ✅

- Plan cards with title, status, task count, complexity
- "Ship it!" button for planning-status plans
- Plan detail sidebar (markdown content)
- Backend: create plan, ship, reship, dependency graph API
- Beads epic + gating task + child tasks creation
- Plan metadata (planId, beadEpicId, gateTaskId, shippedAt, complexity)

### 4.2 Missing / Incomplete

| Item                                 | PRD Reference  | Notes                                                                                                                                                                                   |
| ------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI-assisted decomposition**        | §7.2.2         | "The planning agent analyzes the PRD and suggests a breakdown into features." No AI flow to generate plans from PRD. Plans are created manually via API only.                           |
| **Add Plan UI**                      | §7.2.4         | "Add Plan" button exists but has no handler — no modal/form to create a plan.                                                                                                           |
| **Dependency graph visualization**   | §7.2.2, §7.2.4 | Placeholder only: "Dependency graph visualization will be rendered here." Backend returns `getDependencyGraph` but edges are empty; no frontend graph (e.g., D3, vis.js).               |
| **Plan sidebar chat**                | §7.2.4         | "A sidebar allows conversational interaction with the planning agent to refine individual Plans." Sidebar shows plan markdown only; no chat.                                            |
| **Re-ship button**                   | §7.2.2, §7.2.4 | "Re-ship" for completed plans with pending changes. Backend has `reshipPlan`; frontend does not show Re-ship button on complete plans.                                                  |
| **Upstream PRD propagation on Ship** | §7.2.2, §15.1  | "When a Plan is shipped, the orchestrator invokes the planning agent to review the Plan against the PRD and update any affected sections." Not implemented — ship only closes the gate. |
| **Suggested implementation order**   | §7.2.2         | AI-recommended build sequence — not implemented.                                                                                                                                        |

---

## 5. Build Phase

### 5.1 Implemented ✅

- Kanban board (Planning, Backlog, Ready, In Progress, In Review, Done)
- Start/Pause build orchestrator
- Task cards with title, ID, priority, assignee
- Progress bar (done/total)
- Agent output panel when task selected
- WebSocket: task.updated, agent.output, build.status
- Agent subscribe/unsubscribe for output streaming
- Orchestrator: bd ready → assign → coding phase → review phase
- Two-agent cycle (coding + review)
- Context assembly (PRD excerpt, plan, config, prompt.md)
- Branch management, revert on failure
- 5-minute inactivity timeout
- Retry on review rejection
- Session archival

### 5.2 Missing / Incomplete

| Item                               | PRD Reference | Notes                                                                                                                                                                                                               |
| ---------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Swimlanes by Plan epic**         | §7.3.4        | "Kanban board with swimlanes grouped by Plan epic." Tasks are in flat columns, not grouped by epic.                                                                                                                 |
| **Task detail panel**              | §7.3.4        | "Clicking a card opens a detail panel with the full task specification, live agent output stream... or completed work artifacts." Current panel shows only agent output; no task spec, no artifacts for done tasks. |
| **Completed work artifacts**       | §7.3.4        | "Completed tasks display the full output log and generated artifacts." Sessions are archived but not exposed in UI.                                                                                                 |
| **Plan path resolution for tasks** | Orchestrator  | Orchestrator checks `task.description?.startsWith('.opensprint/plans/')` — but task description is the task spec, not the plan path. Plan path is on the epic. May need to resolve parent epic to get plan.         |
| **Dependency context propagation** | §7.3.2        | `dependencyOutputs` passed as empty array. No collection of diffs/summaries from completed dependency tasks.                                                                                                        |
| **Test command**                   | §12.2         | Uses `npm test` if testFramework set, else echo. No framework detection; testFramework is never set.                                                                                                                |

---

## 6. Validate Phase

### 6.1 Implemented ✅

- Feedback input (natural language)
- Feedback feed with category, status, mapped plan, created tasks
- AI categorization (bug/feature/ux/scope)
- Beads task creation from feedback
- HIL check for scope changes
- WebSocket feedback.mapped broadcast

### 6.2 Missing / Incomplete

| Item                            | PRD Reference | Notes                                                                                                                                                                                                                                      |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PRD updates on scope change** | §7.4.2, §15.1 | "When feedback is categorized as a scope change, the agent reviews the feedback against the current PRD and determines if updates are necessary." Feedback service handles HIL for scope but does not invoke planning agent to update PRD. |
| **discovered-from dependency**  | §14           | `beads.addDependency(repoPath, taskResult.id, item.mappedPlanId, 'discovered-from')` — `mappedPlanId` may be plan ID (e.g. "auth") not bead epic ID. Need to resolve plan → epic.                                                          |
| **Flywheel visibility**         | §7.4.2        | "Once new tickets are created... they automatically enter the Build phase task queue." True, but no explicit link from feedback item to "view in Build" or task status.                                                                    |

---

## 7. Living PRD Synchronization

### 7.1 Missing (Critical)

| Trigger                   | PRD Reference | Current State                                                                                  |
| ------------------------- | ------------- | ---------------------------------------------------------------------------------------------- |
| **Plan shipped**          | §15.1         | Planning agent should review Plan vs PRD and update affected sections. Not implemented.        |
| **Scope-change feedback** | §15.1         | After HIL approval, planning agent should propose PRD updates. Not implemented.                |
| **Change log**            | §10.2, §15.1  | PRD has `changeLog` in schema; backend may support it, but no writes from ship/feedback flows. |

---

## 8. Human-in-the-Loop (HIL)

### 8.1 Implemented ✅

- HIL config in settings (4 categories, 3 modes)
- HilService with `evaluateDecision` for scope changes in feedback
- WebSocket event `hil.request` (in spec)
- Client event `hil.respond` (in spec)

### 8.2 Missing / Incomplete

| Item                     | PRD Reference | Notes                                                                                                                                                     |
| ------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HIL request emission** | §11.2         | Orchestrator never emits `hil.request`. Scope-change feedback uses HIL but other categories (architecture, dependency mods, test failures) are not wired. |
| **hil.respond handling** | WebSocket     | "TODO: Forward HIL response to orchestrator" — WebSocket handler logs but does not forward.                                                               |
| **HIL UI**               | —             | No modal/toast for "approval needed" when orchestrator or feedback flow pauses.                                                                           |

---

## 9. Deployment

### 9.1 Implemented ✅

- Deployment mode stored (expo / custom)
- Selection in project setup

### 9.2 Missing

| Item                        | PRD Reference | Notes                                                                          |
| --------------------------- | ------------- | ------------------------------------------------------------------------------ |
| **Expo.dev integration**    | §6.4          | EAS Build config, OTA updates, preview deployments — not implemented.          |
| **Custom pipeline trigger** | §6.4          | Webhook or command after Build completion — not implemented.                   |
| **Deployment service**      | Codebase      | `deployment-service.ts` exists; needs verification of actual deployment logic. |

---

## 10. Testing & Error Handling

### 10.1 Implemented ✅

- Retry on coding failure (return to Ready)
- Retry on review rejection (with feedback)
- Revert git changes on failure
- 5-minute inactivity timeout
- Session archival with status (success/failed/rejected)

### 10.2 Missing / Incomplete

| Item                               | PRD Reference | Notes                                                                                                                                     |
| ---------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Test execution by orchestrator** | §7.3.2, §8.3  | Orchestrator does not run tests after coding agent completes; relies on agent's result.json. PRD says "run test command as sanity check." |
| **Test results in Build tab**      | §8.3          | "Test results are displayed in the Build tab alongside task status." Not shown.                                                           |
| **Coverage reporting**             | §8.4          | 80% coverage target, coverage reports — not implemented.                                                                                  |
| **HIL escalation on retry limit**  | §9.1          | When retry limit reached, should escalate per HIL config. Currently just fails.                                                           |

---

## 11. API & WebSocket

### 11.1 Implemented ✅

- Projects CRUD, settings
- PRD get/update/history
- Plans CRUD, ship, reship, dependencies
- Tasks list, ready, get, sessions
- Build start/pause/status
- Feedback list, submit, get
- Chat send, history, clear
- WebSocket: task.updated, agent.output, build.status, prd.updated, feedback.mapped
- Client: agent.subscribe, agent.unsubscribe, hil.respond

### 11.2 Missing / Incomplete

| Item                                     | PRD Reference | Notes                                                                                  |
| ---------------------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| **agent.completed** handling in frontend | §11.2         | Backend sends it; frontend may not refresh task list or show completion state clearly. |
| **hil.request** UI                       | §11.2         | No handling of hil.request in frontend.                                                |

---

## 12. Recommended Implementation Order

### Phase A — High Impact, Core UX

1. **Project dropdown selector** — Quick project switching in navbar.
2. **Add Plan flow** — Modal/form + optional AI decomposition from PRD.
3. **Plan AI decomposition** — Invoke planning agent to suggest features from PRD; create plans + tasks.
4. **Living PRD on Ship** — When plan ships, invoke planning agent to update PRD sections.

### Phase B — Plan & Build Polish

5. **Dependency graph visualization** — Render plan dependencies (e.g., D3/vis.js).
6. **Plan sidebar chat** — Conversational refinement of individual plans.
7. **Re-ship button** — Show on complete plans; wire to reship API.
8. **Build: swimlanes by epic** — Group tasks by plan.
9. **Build: task detail panel** — Full spec, artifacts for done tasks.
10. **Dependency context propagation** — Collect diffs from completed dependency tasks for context assembly.

### Phase C — Validate & HIL

11. **PRD updates on scope-change feedback** — After HIL approval, invoke agent to update PRD.
12. **HIL request/response flow** — Emit hil.request from orchestrator/feedback; handle hil.respond; show approval UI.
13. **Fix feedback → epic mapping** — Resolve mappedPlanId (plan ID) to beadEpicId for discovered-from.

### Phase D — Design & Testing

14. **PRD click-to-focus** — Click section to add context to next message.
15. **PRD direct edit** — Inline edit with sync to conversation.
16. **PRD history UI** — View change log and diffs.
17. **Test execution in orchestrator** — Run test command after coding phase.
18. **Custom CLI command input** — Setup UI when Custom agent selected.

### Phase E — Deployment & Nice-to-Have

19. **Expo.dev integration** — EAS Build, preview deployments.
20. **Custom deployment trigger** — Webhook/command after build.
21. **Test framework detection** — Detect or let user select during setup.

---

## 13. Quick Reference — PRD Section Mapping

| PRD Section               | Implementation Location                                             |
| ------------------------- | ------------------------------------------------------------------- |
| §6.1 Home & Project Mgmt  | `Home.tsx`, `Navbar.tsx`                                            |
| §6.2 Project Setup Wizard | `ProjectSetup.tsx`, `project.service.ts`                            |
| §6.3 Agent Config         | `ProjectSetup.tsx`, `ModelSelect.tsx`, `agent-client.ts`            |
| §6.4 Deployment           | `ProjectSetup.tsx`, `deployment-service.ts`                         |
| §6.5 HIL                  | `ProjectSetup.tsx`, `hil-service.ts`                                |
| §7.1 Design               | `DesignPhase.tsx`, `chat.service.ts`, `prd.service.ts`              |
| §7.2 Plan                 | `PlanPhase.tsx`, `plan.service.ts`                                  |
| §7.3 Build                | `BuildPhase.tsx`, `orchestrator.service.ts`, `context-assembler.ts` |
| §7.4 Validate             | `ValidatePhase.tsx`, `feedback.service.ts`                          |
| §11 API                   | `app.ts`, `*Router` files                                           |
| §11.2 WebSocket           | `websocket/index.ts`, `useWebSocket.ts`                             |
