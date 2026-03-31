/**
 * Main column scroll area for Plan, Execute, and Evaluate list regions: small top inset under
 * the phase filter / action bar, horizontal gutters, bottom padding for scroll end.
 */
export const PHASE_MAIN_SCROLL_CLASSNAME =
  "flex-1 min-h-0 overflow-auto pt-2 sm:pt-3 px-4 md:px-6 pb-4 sm:pb-6";

/** Execute scroll column: same inset as Plan; min-width + isolate for timeline/layout stability. */
export const EXECUTE_MAIN_SCROLL_CLASSNAME = `${PHASE_MAIN_SCROLL_CLASSNAME} min-w-0 isolate`;
