# Simplified Two-Tier Agent Configuration

## Overview

Replace the current three-layer agent configuration (Planning Agent Slot, Coding Agent Slot, Per-Complexity Overrides) with a streamlined two-tier model: **Low Complexity** and **High Complexity** agent selections. All agent roles (planning and coding) draw from these same two configurations. The orchestrator maps task/plan complexity to the appropriate tier: `low` and `medium` → Low Complexity agent; `high` and `very_high` → High Complexity agent. Dreamer agents default to High Complexity. All other  agents default to Low Complexity.

This dramatically simplifies the mental model for users — instead of understanding agent slots, role-to-slot mappings, and per-complexity overrides, they just pick two models: a fast/cheap one for routine work and a powerful one for hard problems.

## Acceptance Criteria

1.  **Settings UI** shows exactly two agent configuration sections: "Low Complexity" and "High Complexity", each with Provider + Model (or Custom CLI command).
2.  The old Planning Agent Slot, Coding Agent Slot, and Per-Complexity Overrides sections are removed from the Settings modal and the Project Setup Wizard.
3.  **Data model**: `ProjectSettings` replaces `planningAgent`, `codingAgent`, and `codingAgentByComplexity` with `lowComplexityAgent` and `highComplexityAgent` (both `AgentConfig`).
4.  **Migration**: Existing `settings.json` files are auto-migrated on read. The `codingAgent` (or `codingAgentByComplexity.low`/`.medium` if set) maps to `lowComplexityAgent`; `codingAgentByComplexity.high`/`.very_high` (or `planningAgent` as fallback) maps to `highComplexityAgent`.
5.  **Orchestrator mapping**: Tasks under plans with `low` or `medium` complexity use `lowComplexityAgent`. Tasks under plans with `high` or `very_high` complexity use `highComplexityAgent`. Tasks with no complexity default to `lowComplexityAgent`.
6.  **Planning agent mapping**: Planner, Harmonizer, Auditor, and Summarizer inherit the complexity of the plan they operate on. Dreamer and Analyst always use `lowComplexityAgent`.
7.  **Agent identity / retry escalation**: `AgentIdentityService.selectAgentForRetry()` continues to work — it uses the resolved tier config as its base and can still escalate model within the same provider.
8.  All existing tests updated or replaced; no regressions in orchestrator behavior.
9.  The `PUT /api/v1/projects/:id/settings` endpoint accepts the new shape and rejects the old shape (after migration).

## Technical Approach

### Shared types (`packages/shared/src/types/settings.ts`)

Replace:

```typescript
interface ProjectSettings {
  planningAgent: AgentConfig;
  codingAgent: AgentConfig;
  codingAgentByComplexity?: CodingAgentByComplexity;
  // ...
}
```

With:

```typescript
interface ProjectSettings {
  lowComplexityAgent: AgentConfig;
  highComplexityAgent: AgentConfig;
  // ...
}
```

Replace `getCodingAgentForComplexity()` with:

```typescript
function getAgentForComplexity(
  settings: ProjectSettings,
  complexity: PlanComplexity | undefined
): AgentConfig {
  if (complexity === "high" || complexity === "very_high") {
    return settings.highComplexityAgent;
  }
  return settings.lowComplexityAgent;
}
```

Add a migration function:

```typescript
function migrateSettings(raw: any): ProjectSettings {
  if (raw.lowComplexityAgent) return raw; // already migrated
  // Map old shape → new shape
}
```

### Backend settings read path (`ProjectService.getSettings()`)

Apply `migrateSettings()` when reading `settings.json`. On first save after migration, the new shape is persisted, completing the migration.

### Backend validation (`agent-config.ts`)

Update the Zod schema for settings to expect `lowComplexityAgent` / `highComplexityAgent` instead of the old fields.

### Orchestrator (`phase-executor.service.ts`, `agent-identity.service.ts`)

Replace all calls to `getCodingAgentForComplexity()` with `getAgentForComplexity()`. For planning-slot agents, add a `getAgentForPlanningRole()` helper that resolves the plan's complexity (or defaults to low).

### Frontend Settings Modal (`ProjectSettingsModal.tsx`)

Replace the three sections (Planning Agent, Coding Agent, Per-Complexity Overrides) with two sections: "Low Complexity" and "High Complexity", each containing Provider dropdown + Model select (or CLI command input).

### Frontend Setup Wizard (`AgentsStep.tsx`)

Replace `planningAgent`/`codingAgent` props with `lowComplexityAgent`/`highComplexityAgent`. Update the step UI accordingly.

## Dependencies

- No external dependencies.
- This is a settings/config refactor touching shared types, backend services, and frontend components. All changes are internal.

## Data Model Changes

### `ProjectSettings` (`.opensprint/settings.json`)

**Removed fields:**

- `planningAgent: AgentConfig`
- `codingAgent: AgentConfig`
- `codingAgentByComplexity?: CodingAgentByComplexity`

**Added fields:**

- `lowComplexityAgent: AgentConfig` — provider/model for low and medium complexity work
- `highComplexityAgent: AgentConfig` — provider/model for high and very_high complexity work

**Migration mapping:**

Old field

New field

Logic

`codingAgentByComplexity.low` or `codingAgentByComplexity.medium` or `codingAgent`

`lowComplexityAgent`

First defined override wins, else `codingAgent`

`codingAgentByComplexity.high` or `codingAgentByComplexity.very_high` or `planningAgent`

`highComplexityAgent`

First defined override wins, else `planningAgent`

### `CodingAgentByComplexity` type

Removed entirely.

## API Specification

### `PUT /api/v1/projects/:id/settings`

**New request body shape (settings subset):**

```json
{
  "lowComplexityAgent": { "type": "cursor", "model": "composer-1.5", "cliCommand": null },
  "highComplexityAgent": { "type": "cursor", "model": "opus-4.6-thinking", "cliCommand": null },
  "deployment": { ... },
  "hilConfig": { ... }
}
```

**Old fields `planningAgent`, `codingAgent`, `codingAgentByComplexity` are no longer accepted.** If sent, the endpoint returns 400 with a migration hint.

### `GET /api/v1/projects/:id/settings`

Always returns the new shape. If the on-disk file is in the old format, it is migrated on read.

## UI/UX Requirements

### Settings Modal — Agent Config tab

The "Agent Config" tab shows two visually identical sections stacked vertically, separated by a divider:

1.  **Low Complexity** — "Used for routine tasks (low and medium complexity plans)"
2.  **High Complexity** — "Used for challenging tasks (high and very high complexity plans)"

Each section has:

- Provider dropdown (Claude / Cursor / Custom CLI)
- Model select (when provider is Claude or Cursor)
- CLI command input (when provider is Custom)

The Per-Complexity Overrides section is removed entirely.

### Project Setup Wizard — Agents Step

Same two-section layout as the Settings Modal agent tab. Labels:

- "Low Complexity Agent" with subtitle "For routine and moderate tasks"
- "High Complexity Agent" with subtitle "For complex and cross-cutting tasks"

### Mockup

See `mockups` field.

## Edge Cases and Error Handling

1.  **Missing settings.json**: Default both tiers to `{ type: 'cursor', model: null, cliCommand: null }` (same as current default behavior).
2.  **Old-format settings.json**: Auto-migrate on read. Log a migration notice. Persist new format on next save.
3.  **Partially defined old format** (e.g., `codingAgent` exists but `planningAgent` doesn't): Migration handles each field independently with fallbacks.
4.  **Task with no plan complexity**: Defaults to `lowComplexityAgent`.
5.  **Agent escalation on retry**: `AgentIdentityService` escalates within the resolved tier's provider. If `lowComplexityAgent` is Cursor/composer-1.5, escalation still works as before.
6.  **Both tiers set to same provider/model**: Valid — user might want the same model everywhere. No special handling needed.
7.  **Custom CLI for one tier, Claude for another**: Valid — each tier is independent.
8.  **API key missing for selected provider**: Existing warning banner logic in the UI already handles this; just needs to check both tier configs instead of planning/coding slots.

## Testing Strategy

### Unit Tests

- `getAgentForComplexity()` — test all 4 complexity levels + undefined → correct tier
- `migrateSettings()` — test old format → new format for all migration paths (with/without overrides, partial configs)
- `AgentIdentityService.selectAgentForRetry()` — verify escalation still works with new settings shape

### Integration Tests

- `ProjectService.getSettings()` — reads old-format file → returns new shape
- `ProjectService.updateSettings()` — saves new shape → persists correctly
- Settings round-trip: save → read → save produces identical output

### Frontend Tests

- `ProjectSettingsModal` — renders two agent sections, saves correct shape
- `AgentsStep` (wizard) — renders two agent sections, propagates changes
- API key warning banner — shows for providers used in either tier

### E2E Tests

- Create project with setup wizard → verify settings.json has new shape
- Change agent config in settings modal → verify orchestrator uses correct model for next task

## Estimated Complexity

Medium. The change is primarily a refactor of existing plumbing (types, settings read/write, UI forms). The migration path adds some complexity, but the overall surface area is well-bounded: shared types, one backend service, two frontend components, and the orchestrator's agent resolution logic.
