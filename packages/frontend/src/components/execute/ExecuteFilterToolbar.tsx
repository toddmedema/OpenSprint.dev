import type { StatusFilter } from "../../lib/executeTaskFilter";

interface ExecuteFilterToolbarProps {
  chipConfig: { label: string; filter: StatusFilter; count: number }[];
  statusFilter: StatusFilter;
  setStatusFilter: (f: StatusFilter) => void;
  awaitingApproval: boolean;
  searchExpanded: boolean;
  searchInputValue: string;
  setSearchInputValue: (v: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  handleSearchExpand: () => void;
  handleSearchClose: () => void;
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
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
}: ExecuteFilterToolbarProps) {
  return (
    <div className="px-6 py-4 border-b border-theme-border bg-theme-surface shrink-0">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
          {chipConfig.map(({ label, filter, count }) => {
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
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-brand-600 text-white ring-2 ring-brand-500 ring-offset-2 ring-offset-theme-bg"
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
            <span className="ml-2 text-sm font-medium text-theme-warning-text">
              Awaiting approval…
            </span>
          )}
        </div>
        <div className="flex items-center shrink-0">
          {searchExpanded ? (
            <div
              className="flex items-center gap-1 overflow-hidden animate-fade-in"
              data-testid="execute-search-expanded"
            >
              <input
                ref={searchInputRef}
                type="text"
                value={searchInputValue}
                onChange={(e) => setSearchInputValue(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search tickets…"
                className="w-48 sm:w-56 px-3 py-1.5 text-sm bg-theme-surface-muted border border-theme-border rounded-md text-theme-text placeholder:text-theme-muted focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                aria-label="Search tickets"
              />
              <button
                type="button"
                onClick={handleSearchClose}
                className="p-1.5 rounded-md text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle transition-colors"
                aria-label="Close search"
                data-testid="execute-search-close"
              >
                <svg
                  className="w-5 h-5"
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
              className="p-1.5 rounded-md text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle transition-colors"
              aria-label="Expand search"
              data-testid="execute-search-expand"
            >
              <svg
                className="w-5 h-5"
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
        </div>
      </div>
    </div>
  );
}
