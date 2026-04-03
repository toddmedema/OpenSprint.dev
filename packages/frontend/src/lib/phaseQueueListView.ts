/**
 * Shared layout tokens for Plan list view and Execute timeline — queue-style rows with
 * divide-y sections (see also PhaseScrollSectionHeader).
 */

/** `<ul>` body under each section header: no bullets, hairline dividers between rows. */
export const PHASE_QUEUE_LIST_SECTION_BODY_CLASSNAME =
  "list-none divide-y divide-theme-border-subtle";

/** Inner flex strip: primary label + trailing actions (matches Plan + Timeline row chrome). */
export const PHASE_QUEUE_ROW_INNER_CLASSNAME =
  "flex items-center gap-2 px-4 py-2.5 group overflow-x-auto md:overflow-x-visible min-w-0";

const PHASE_QUEUE_ROW_PRIMARY_LAYOUT =
  "flex-1 flex items-center gap-3 text-left text-sm min-w-0 focus:outline-none focus-visible:outline-none";

const PHASE_QUEUE_ROW_SURFACE_BASE = "transition-colors";

/** Unselected rows: neutral hover (distinct from selected accent treatment). */
const PHASE_QUEUE_ROW_SURFACE_UNSELECTED = `${PHASE_QUEUE_ROW_SURFACE_BASE} hover:bg-theme-surface-muted`;

/** Selected row: match active-project subtle blue surface (no box/ring effect). */
const PHASE_QUEUE_ROW_SURFACE_SELECTED = `${PHASE_QUEUE_ROW_SURFACE_BASE} bg-theme-info-bg`;

/** Outer row surface for full-width hover/selected treatment. */
export function phaseQueueRowSurfaceClassName(isSelected: boolean): string {
  return isSelected ? PHASE_QUEUE_ROW_SURFACE_SELECTED : PHASE_QUEUE_ROW_SURFACE_UNSELECTED;
}

/** Main row hit target (open plan / task detail). */
export function phaseQueueRowPrimaryButtonClassName(isSelected: boolean): string {
  void isSelected;
  return PHASE_QUEUE_ROW_PRIMARY_LAYOUT;
}

/** Primary title / label cell in the row button. */
export const PHASE_QUEUE_ROW_TITLE_CLASSNAME =
  "flex-1 min-w-0 truncate font-medium text-theme-text";

/** Secondary column text (counts, timestamps, muted labels). */
export const PHASE_QUEUE_ROW_META_MUTED_CLASSNAME = "shrink-0 text-xs text-theme-muted";

/**
 * Virtualized timeline: scroll parent cannot use `divide-y`, so each row supplies its own
 * bottom border to match the list visual.
 */
export const PHASE_QUEUE_ROW_VIRTUAL_OUTER_CLASSNAME =
  "border-b border-theme-border-subtle min-h-[52px] flex w-full items-center";
