/**
 * Shared sticky section rails inside phase main scroll areas (Plan list, Execute timeline).
 * Glass treatment matches Plan list: translucent page background + blur.
 *
 * Row/list chrome under each header lives in `phaseQueueListView.ts` (divide-y lists, row flex strip).
 */

export const PHASE_SCROLL_SECTION_HEADER_GLASS_CLASSNAME =
  "bg-theme-bg/95 backdrop-blur-sm [background-clip:padding-box]";

/** Negative horizontal margin + padding to align with phase scroll gutters (px-4 / sm:px-6). */
export const PHASE_SCROLL_SECTION_HEADER_GUTTER_CLASSNAME = "-mx-4 sm:-mx-6 px-4 sm:px-6";

export const PHASE_SCROLL_SECTION_HEADER_BORDER_CLASSNAME = "border-b border-theme-border-subtle";

export const PHASE_SCROLL_SECTION_HEADER_TITLE_CLASSNAME =
  "text-xs font-semibold text-theme-muted tracking-wide uppercase";

/** Plan list: offset into scroll top padding so the glass bar meets the toolbar inset cleanly. */
export const PLAN_SCROLL_SECTION_HEADER_CLASSNAME = [
  "sticky top-[-0.5rem] sm:top-[-0.75rem] z-10",
  PHASE_SCROLL_SECTION_HEADER_GUTTER_CLASSNAME,
  "pt-6 pb-[2px] mb-[7px]",
  PHASE_SCROLL_SECTION_HEADER_BORDER_CLASSNAME,
  PHASE_SCROLL_SECTION_HEADER_GLASS_CLASSNAME,
].join(" ");

/** Execute timeline (non-virtual): sticks to top of scrollport. */
export const EXECUTE_TIMELINE_SCROLL_SECTION_HEADER_CLASSNAME = [
  "sticky top-0 z-[12]",
  PHASE_SCROLL_SECTION_HEADER_GUTTER_CLASSNAME,
  "pt-3 sm:pt-4 pb-[2px]",
  PHASE_SCROLL_SECTION_HEADER_BORDER_CLASSNAME,
  PHASE_SCROLL_SECTION_HEADER_GLASS_CLASSNAME,
].join(" ");

/** Virtualized timeline header rows (scroll with content; same chrome as sticky). */
export const EXECUTE_TIMELINE_VIRTUAL_SECTION_HEADER_CLASSNAME = [
  PHASE_SCROLL_SECTION_HEADER_GUTTER_CLASSNAME,
  "pt-3 sm:pt-4 pb-[2px] min-h-[44px]",
  PHASE_SCROLL_SECTION_HEADER_BORDER_CLASSNAME,
  PHASE_SCROLL_SECTION_HEADER_GLASS_CLASSNAME,
].join(" ");
