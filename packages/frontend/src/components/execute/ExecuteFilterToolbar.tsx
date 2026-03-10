import type { StatusFilter } from "../../lib/executeTaskFilter";
import { PHASE_TOOLBAR_HEIGHT, PHASE_TOOLBAR_BUTTON_SIZE } from "../../lib/constants";
import { ViewToggle } from "./ViewToggle";

function GridIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="2" width="5" height="5" rx="0.5" />
      <rect x="9" y="2" width="5" height="5" rx="0.5" />
      <rect x="2" y="9" width="5" height="5" rx="0.5" />
      <rect x="9" y="9" width="5" height="5" rx="0.5" />
    </svg>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 4h12" />
      <path d="M2 8h12" />
      <path d="M2 12h12" />
    </svg>
  );
}

interface ExecuteFilterToolbarProps {
  chipConfig: { label: string; filter: StatusFilter; count: number }[];
  statusFilter: StatusFilter;
  setStatusFilter: (f: StatusFilter) => void;
  awaitingApproval: boolean;
  /** When true, show a small non-blocking indicator that self-improvement review is in progress */
  selfImprovementRunInProgress?: boolean;
  searchExpanded: boolean;
  searchInputValue: string;
  setSearchInputValue: (v: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  handleSearchExpand: () => void;
  handleSearchClose: () => void;
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  viewMode: "kanban" | "timeline";
  onViewModeChange: (mode: "kanban" | "timeline") => void;
  /** When "per_epic", show epic merge mode indicator. Omit or "per_task" = no indicator. */
  mergeStrategy?: "per_task" | "per_epic";
}

export function ExecuteFilterToolbar({
  chipConfig,
  statusFilter,
  setStatusFilter,
  awaitingApproval,
  searchExpanded,
  searchInputValue,
  setSearchInputValue,
  searchInputRef,
  handleSearchExpand,
  handleSearchClose,
  handleSearchKeyDown,
  viewMode,
  onViewModeChange,
  mergeStrategy,
  selfImprovementRunInProgress = false,
}: ExecuteFilterToolbarProps) {
  const showEpicMergeIndicator = mergeStrategy === "per_epic";

  return (
    <div
      className="phase-toolbar w-full px-4 sm:px-6 flex items-center py-0.5 border-b border-theme-border bg-theme-surface shrink-0"
      style={{ height: PHASE_TOOLBAR_HEIGHT }}
      data-testid="execute-filter-toolbar"
    >
      <div className="flex w-full items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto overflow-y-visible flex-nowrap py-0.5 pl-2">
          {chipConfig.filter((c) => c.filter === "all" || c.count > 0).map(({ label, filter, count }) => {
            const isActive = statusFilter === filter;
            const isAll = filter === "all";
            const handleClick = () => {
              setStatusFilter(isActive && !isAll ? "all" : filter);
            };
            return (
              <button
                key={filter}
                type="button"
                onClick={handleClick}
                data-testid={`filter-chip-${filter}`}
                style={{ minHeight: PHASE_TOOLBAR_BUTTON_SIZE, minWidth: PHASE_TOOLBAR_BUTTON_SIZE }}
                className={`inline-flex items-center justify-center gap-1 rounded-sm px-2 py-0.5 text-sm font-medium transition-colors shrink-0 ${
                  isActive
                    ? "bg-brand-600 text-white ring-2 ring-brand-500 ring-offset-1 ring-offset-theme-bg"
                    : "bg-theme-surface-muted text-theme-text hover:bg-theme-border-subtle"
                }`}
                aria-pressed={isActive}
                aria-label={`${label} ${count}${isActive ? ", selected" : ""}`}
              >
                <span>{label}</span>
                <span className={isActive ? "opacity-90" : "text-theme-muted"}>{count}</span>
              </button>
            );
          })}
          {awaitingApproval && (
            <span className="ml-2 text-sm font-medium text-theme-warning-text shrink-0">
              Awaiting approval…
            </span>
          )}
          {selfImprovementRunInProgress && (
            <span
              className="ml-2 text-sm text-theme-muted shrink-0"
              data-testid="execute-self-improvement-indicator"
              title="New tasks may appear from the self-improvement review"
            >
              Self-improvement review in progress
            </span>
          )}
          {showEpicMergeIndicator && (
            <span
              className="ml-2 text-xs text-theme-muted shrink-0"
              data-testid="execute-epic-merge-indicator"
              title="Changes merge to main when the plan (epic) is complete"
            >
              Epic merge mode: changes merge when plan is complete
            </span>
          )}
        </div>
        <div className="flex items-center shrink-0 gap-1 sm:gap-2">
          {searchExpanded ? (
            <div
              className="flex items-center gap-1 animate-fade-in"
              data-testid="execute-search-expanded"
            >
              <input
                ref={searchInputRef}
                type="text"
                value={searchInputValue}
                onChange={(e) => setSearchInputValue(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search tickets…"
                className="w-36 sm:w-48 md:w-56 px-2.5 py-1 text-sm bg-theme-surface-muted rounded-sm text-theme-text placeholder:text-theme-muted border border-theme-border focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all"
                aria-label="Search tickets"
              />
              <button
                type="button"
                onClick={handleSearchClose}
                style={{ minHeight: PHASE_TOOLBAR_BUTTON_SIZE, minWidth: PHASE_TOOLBAR_BUTTON_SIZE }}
                className="p-1 rounded-sm text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle transition-colors inline-flex items-center justify-center"
                aria-label="Close search"
                data-testid="execute-search-close"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSearchExpand}
              style={{ minHeight: PHASE_TOOLBAR_BUTTON_SIZE, minWidth: PHASE_TOOLBAR_BUTTON_SIZE }}
              className="p-1 rounded-sm text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle transition-colors inline-flex items-center justify-center"
              aria-label="Expand search"
              data-testid="execute-search-expand"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </button>
          )}
          <div>
            <ViewToggle
              options={[
                { value: "kanban", icon: <GridIcon className="w-3 h-3" />, label: "Kanban view" },
                {
                  value: "timeline",
                  icon: <ListIcon className="w-3 h-3" />,
                  label: "Timeline view",
                },
              ]}
              value={viewMode}
              onChange={onViewModeChange}
              compact
            />
          </div>
        </div>
      </div>
    </div>
  );
}
