# Priority Level Icons

## Overview

Add visual priority level icons that accompany the text labels for task priority across the OpenSprint UI. Each of the five priority levels (Critical, High, Medium, Low, Lowest) gets a distinct SVG icon matching the Jira priority icon style, rendered via a shared `PriorityIcon` component. These icons improve at-a-glance scannability when triaging and monitoring tasks.

The icons will be added in four specific locations:

1. **Execute details sidebar** — next to the priority dropdown trigger and inside each dropdown option
2. **Evaluate feedback input** — inside the priority `<select>` dropdown options
3. **Execute epic view** — to the left of each task name in the `BuildEpicCard` task rows
4. **Evaluate feedback detail cards** — to the left of each created-task name in the ticket info section of `FeedbackCard`

## Acceptance Criteria

- [ ] A reusable `PriorityIcon` component exists in `packages/frontend/src/components/PriorityIcon.tsx`
- [ ] The component accepts a `priority` prop (0–4) and an optional `size` prop (`xs` | `sm` | `md`), defaulting to `sm`
- [ ] Each priority level renders a visually distinct inline SVG icon matching the Jira priority icon style:
  - **0 (Critical):** Red gradient shield/pennant (`#ff5630` → `#ff8f73`)
  - **1 (High):** Red single upward chevron (`#ff5630`)
  - **2 (Medium):** Amber two horizontal bars (`#FFAB00`)
  - **3 (Low):** Blue single downward chevron (`#0065ff`)
  - **4 (Lowest):** Blue duo-tone double downward chevron (`#0065ff` + `#2684ff`)
- [ ] Each icon has an `aria-label` of the priority label (e.g. "Critical") and `role="img"`
- [ ] In the Execute details sidebar (`TaskDetailSidebar.tsx`):
  - The priority dropdown trigger shows the icon to the left of the priority label text
  - Each dropdown option shows the icon to the left of the label
- [ ] In the Evaluate priority dropdown (`EvalPhase.tsx`):
  - Each `<option>` in the priority `<select>` is prefaced with a text-based priority indicator (since `<option>` cannot render SVG), OR the `<select>` is converted to a custom dropdown that renders `PriorityIcon` inline
- [ ] In the Execute epic view (`BuildEpicCard.tsx` → `EpicTaskRow`):
  - `PriorityIcon` renders to the left of the task title (between the status badge and the title text)
- [ ] In the Evaluate feedback detail cards (`EvalPhase.tsx` → `FeedbackCard`):
  - `PriorityIcon` renders to the left of each created-task ID/name in the ticket info row
- [ ] All existing tests continue to pass
- [ ] New unit tests cover the `PriorityIcon` component (renders correct icon per priority, supports sizes, handles edge cases)

## Technical Approach

### 1. Create the `PriorityIcon` component

A single-file React component using inline SVG paths sourced from the Jira priority icon set. No external icon library dependency needed — the five icons are embedded as literal SVG path data. The component maps the numeric priority to the correct SVG path(s) and fill color(s).

```tsx
// packages/frontend/src/components/PriorityIcon.tsx
export interface PriorityIconProps {
  priority: number;
  size?: "xs" | "sm" | "md";
  className?: string;
}
```

Size mapping:

- `xs`: `w-3 h-3` (12px) — for inline use in compact rows
- `sm`: `w-4 h-4` (16px) — default, for dropdowns and labels
- `md`: `w-5 h-5` (20px) — for larger display contexts

All icons use a **16×16 SVG viewBox** with filled paths (no stroke):

- **Critical (0):** Shield/pennant shape with a `<linearGradient>` fill from `#ff5630` (top) to `#ff8f73` (bottom). SVG path: `M2.5 4l5-2.9c.3-.2.7-.2 1 0l5 2.9c.3.2.5.5.5.9v8.2c0 .6-.4 1-1 1-.2 0-.4 0-.5-.1L8 11.4 3.5 14c-.5.3-1.1.1-1.4-.4-.1-.1-.1-.3-.1-.5V4.9c0-.4.2-.7.5-.9z`
- **High (1):** Single upward chevron, fill `#ff5630`. SVG path: `M3.5 9.9c-.5.3-1.1.1-1.4-.3s-.1-1.1.4-1.4l5-3c.3-.2.7-.2 1 0l5 3c.5.3.6.9.3 1.4-.3.5-.9.6-1.4.3L8 7.2 3.5 9.9z`
- **Medium (2):** Two horizontal bars, fill `#FFAB00`. SVG path: `M3,4h10c0.6,0,1,0.4,1,1s-0.4,1-1,1H3C2.4,6,2,5.6,2,5S2.4,4,3,4z M3,10h10c0.6,0,1,0.4,1,1s-0.4,1-1,1H3c-0.6,0-1-0.4-1-1S2.4,10,3,10z`
- **Low (3):** Single downward chevron, fill `#0065ff`. SVG path: `M12.5 6.1c.5-.3 1.1-.1 1.4.4.3.5.1 1.1-.3 1.3l-5 3c-.3.2-.7.2-1 0l-5-3c-.6-.2-.7-.9-.4-1.3.2-.5.9-.7 1.3-.4L8 8.8l4.5-2.7z`
- **Lowest (4):** Two stacked downward chevrons, duo-tone blue. First path fill `#0065ff`: `M12.504883 8.14541c.5-.3 1.1-.1 1.4.4s.1 1-.4 1.3l-5 3c-.3.2-.7.2-1 0l-5-3c-.5-.3-.6-.9-.3-1.4.2-.4.8-.6 1.3-.3l4.5 2.7 4.5-2.7z`. Second path fill `#2684ff`: `M12.504883 3.84541c.5-.3 1.1-.2 1.4.3s.1 1.1-.4 1.4l-5 3c-.3.2-.7.2-1 0l-5-3c-.5-.3-.6-.9-.3-1.4.3-.5.9-.6 1.4-.3l4.4 2.7 4.5-2.7z`

Since these icons use hardcoded hex fills rather than `currentColor`, they look the same in light and dark mode — the Jira colors provide sufficient contrast on both backgrounds.

### 2. Integrate into the Execute details sidebar

Modify `TaskDetailSidebar.tsx`:

- Import `PriorityIcon`
- Add `<PriorityIcon priority={taskDetail.priority ?? 1} size="xs" />` inside the dropdown trigger button, before the label `<span>`
- Add `<PriorityIcon priority={p} size="xs" />` inside each dropdown `<li>` option, before the label text

### 3. Integrate into the Evaluate priority dropdown

The native `<select>` element cannot render custom SVG icons inside `<option>` tags. Two options:

- **Option A (minimal change):** Prepend a Unicode arrow character to each option label (e.g. `⏫ Critical`). This works in all browsers but is less polished.
- **Option B (recommended):** Convert the priority `<select>` to a custom dropdown component (similar to the one in `TaskDetailSidebar`) that renders `PriorityIcon` next to each option. This gives visual consistency with the sidebar.

We'll go with **Option B** — extract a reusable `PrioritySelect` component that wraps a custom dropdown with `PriorityIcon` in both the trigger and options.

### 4. Integrate into Execute epic view

Modify `BuildEpicCard.tsx` → `EpicTaskRow`:

- Import `PriorityIcon`
- Add `<PriorityIcon priority={task.priority} size="xs" />` between the `TaskStatusBadge` and the title `<span>` in the task row

### 5. Integrate into Evaluate feedback cards

Modify `EvalPhase.tsx` → `FeedbackCard`:

- The feedback card ticket info section shows `createdTaskIds` with status badges. We need to show priority here too.
- This requires the task's priority to be available. The `FeedbackCard` already receives `getTaskColumn` — we'll add a `getTaskPriority` callback (or reuse the existing task lookup) to retrieve priority for each created task.
- Add `<PriorityIcon priority={priority} size="xs" />` to the left of each task ID/name chip.

## Dependencies

- No new npm packages required — icons are inline SVG paths from the Jira priority icon set
- Depends on the existing `PRIORITY_LABELS` constant from `@opensprint/shared`
- Depends on the existing Tailwind CSS configuration (for size utility classes only; icon colors are hardcoded hex)

## Data Model Changes

No data model changes required. The `Task.priority` field (0–4) already exists in the shared types.

## API Specification

No API changes required. All data needed (task priority) is already available in existing API responses.

## UI/UX Requirements

### Icon Design Specification

All icons use a 16×16 viewBox with filled paths (no stroke). Colors are hardcoded hex values from the Jira priority icon palette, providing consistent appearance in both light and dark themes.

| Priority | Value | Icon Shape                    | Fill Color(s)                    |
| -------- | ----- | ----------------------------- | -------------------------------- |
| Critical | 0     | Shield/pennant (upward point) | Gradient: `#ff5630` → `#ff8f73`  |
| High     | 1     | Single upward chevron         | `#ff5630`                        |
| Medium   | 2     | Two horizontal bars           | `#FFAB00`                        |
| Low      | 3     | Single downward chevron       | `#0065ff`                        |
| Lowest   | 4     | Two stacked downward chevrons | `#0065ff` + `#2684ff` (duo-tone) |

### Gradient Handling for Critical Icon

The Critical icon uses an SVG `<linearGradient>`. To avoid `id` collisions when multiple Critical icons render on the same page, generate a unique gradient ID per component instance (e.g. using `React.useId()` or a counter).

### Placement Rules

- Icons always appear **to the left** of the associated text
- Icons use the `xs` size (12px) in compact rows (epic task rows, feedback ticket chips)
- Icons use the `sm` size (16px) in dropdown triggers and options
- Icons have a `gap` of 4–6px from adjacent text (achieved via parent flex gap)
- Icons must be `shrink-0` to prevent squishing in truncated layouts

### Accessibility

- Each icon SVG has `role="img"` and `aria-label` matching the priority label
- Color is **not** the sole indicator — the text label is always present alongside the icon
- Icons respect `prefers-reduced-motion` (no animations on these icons, so no concern)

### Mockup: Execute Epic Card with Priority Icons

```
┌─────────────────────────────────────────────┐
│  Authentication System                      │
│  Progress: 2/4 (50%)                        │
│  ████████████░░░░░░░░░░░░                   │
├─────────────────────────────────────────────┤
│  ● 🔺 Set up database schema      agent-1  │
│  ● ▲  Implement user model                  │
│  ◌ ═  Build auth endpoints                  │
│  ◌ ▽  Write integration tests               │
│         +2 more                             │
└─────────────────────────────────────────────┘

Legend: ● = done (green dot), ◌ = pending (gray dot)
        🔺 = Critical (red shield), ▲ = High (red chevron up)
        ═ = Medium (amber bars), ▽ = Low (blue chevron down)
```

### Mockup: Task Detail Sidebar Priority Dropdown

```
┌──────────────────────────────────────┐
│  Task Detail                    [X]  │
├──────────────────────────────────────┤
│  ● Ready                             │
│                                      │
│  [▲ High ▼]                          │
│  ┌──────────────────┐                │
│  │ 🔺 0: Critical    │               │
│  │ ▲  1: High    ✓  │                │
│  │ ═  2: Medium     │                │
│  │ ▽  3: Low        │                │
│  │ ⊻  4: Lowest     │                │
│  └──────────────────┘                │
│                                      │
│  Description                         │
│  ─────────────────                   │
│  Implement JWT auth endpoints...     │
└──────────────────────────────────────┘
```

### Mockup: Evaluate Feedback Card with Priority Icons

```
┌─────────────────────────────────────────────┐
│  Login button doesn't work on       [Bug]   │
│  mobile Safari when user taps too           │
│  quickly...                                 │
│                                             │
│  [● ▲ Ready bd-a3f8.3]  [Reply] [Resolve]  │
└─────────────────────────────────────────────┘

Legend: ● = status dot, ▲ = priority icon (High, red)
```

### Mockup: Evaluate Priority Input Dropdown

```
┌─────────────────────────────────────────────┐
│  What did you find?                         │
│  ┌─────────────────────────────────────┐    │
│  │ Describe a bug, suggest a feature...│    │
│  └─────────────────────────────────────┘    │
│                                             │
│       [🔺 Critical ▼]  [📎] [Submit]       │
│       ┌──────────────────┐                  │
│       │   Priority (opt.) │                 │
│       │ 🔺 Critical       │                │
│       │ ▲  High          │                  │
│       │ ═  Medium        │                  │
│       │ ▽  Low           │                  │
│       │ ⊻  Lowest        │                  │
│       └──────────────────┘                  │
└─────────────────────────────────────────────┘
```

## Edge Cases and Error Handling

1. **Undefined/null priority:** If `task.priority` is `undefined` or `null`, default to priority `2` (Medium) for icon display — consistent with the existing `?? 1` fallback in the sidebar (which should arguably be `2` but we'll match the existing convention of defaulting to `1`/High).
2. **Out-of-range priority:** If priority is outside 0–4, render the Medium icon as a safe fallback.
3. **Gate tasks (`.0` tasks):** Gate tasks have priorities too; icons render normally for them.
4. **Feedback cards without created tasks:** No priority icons shown — they only appear next to task references.
5. **Feedback tasks with unknown task IDs:** If the task isn't in the Redux store (e.g., deleted), skip the priority icon (show nothing rather than a fallback).
6. **Native `<select>` fallback:** If JavaScript fails to hydrate, the Evaluate priority dropdown falls back to the native `<select>` which shows text-only options — acceptable degradation.
7. **SVG gradient ID collisions:** The Critical icon uses a `<linearGradient>` with an `id` attribute. If multiple Critical icons render on the same page, duplicate IDs cause rendering bugs. Use `React.useId()` (React 18+) to generate unique gradient IDs per instance.
8. **Theme compatibility:** Icon colors are hardcoded hex values from the Jira palette, which provide sufficient contrast on both light and dark backgrounds. No `dark:` variant overrides needed.

## Testing Strategy

### Unit Tests

1. **`PriorityIcon.test.tsx`:**
   - Renders the correct SVG for each priority level (0–4): verifies path data or a distinguishing attribute per level
   - Critical icon includes an SVG `<linearGradient>` element
   - Lowest icon renders two `<path>` elements (duo-tone)
   - Applies correct size classes for `xs`, `sm`, `md`
   - Defaults to `sm` when no size prop provided
   - Handles out-of-range priority gracefully (falls back to Medium)
   - Includes correct `aria-label` for each priority
   - Applies custom `className` prop
   - Multiple Critical icons on the same page have unique gradient IDs

2. **`TaskDetailSidebar.test.tsx` (update existing):**
   - Priority dropdown trigger renders a `PriorityIcon`
   - Each dropdown option renders a `PriorityIcon` with correct priority
   - Icon updates when priority changes

3. **`BuildEpicCard.test.tsx` (update existing):**
   - Each task row renders a `PriorityIcon` to the left of the title
   - Icon reflects the task's actual priority value

4. **`EvalPhase.test.tsx` (update existing):**
   - Priority select dropdown shows `PriorityIcon` in trigger and options
   - Feedback cards with created tasks show `PriorityIcon` next to each task chip

### Integration Tests

- Verify that priority icons render correctly across theme switches (light/dark)
- Verify that clicking priority icon areas doesn't interfere with existing click handlers

## Estimated Complexity

**Medium** — The core icon component is straightforward, but integrating it into four distinct UI locations (two of which involve dropdown refactoring) and ensuring accessibility, gradient ID uniqueness, and test coverage across all locations makes this a solid medium-complexity task.
