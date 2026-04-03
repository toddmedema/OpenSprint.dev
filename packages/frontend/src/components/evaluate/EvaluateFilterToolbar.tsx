import type { KeyboardEvent, RefObject } from "react";
import { SegmentedControl } from "../controls/SegmentedControl";
import { FilterBar } from "../controls/FilterBar";

export type EvaluateStatusFilterChip = "all" | "pending" | "resolved" | "cancelled";

interface EvaluateFilterToolbarProps {
  chipConfig: { label: string; filter: EvaluateStatusFilterChip; count: number }[];
  statusFilter: EvaluateStatusFilterChip;
  setStatusFilter: (f: EvaluateStatusFilterChip) => void;
  searchExpanded: boolean;
  searchInputValue: string;
  setSearchInputValue: (v: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  handleSearchExpand: () => void;
  handleSearchClose: () => void;
  handleSearchKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export function EvaluateFilterToolbar({
  chipConfig,
  statusFilter,
  setStatusFilter,
  searchExpanded,
  searchInputValue,
  setSearchInputValue,
  searchInputRef,
  handleSearchExpand,
  handleSearchClose,
  handleSearchKeyDown,
}: EvaluateFilterToolbarProps) {
  const left = (
    <SegmentedControl
      size="phase"
      dataTestId="eval-filter-segmented"
      value={statusFilter}
      onChange={(next) => {
        const isActive = statusFilter === next;
        setStatusFilter(isActive && next !== "all" ? "all" : next);
      }}
      options={chipConfig
        .filter((c) => c.filter === "all" || c.filter === "pending" || c.count > 0)
        .map(({ label, filter, count }) => ({
          value: filter,
          label,
          count,
          testId: `eval-filter-chip-${filter}`,
          ariaLabel: `${label} ${count}${statusFilter === filter ? ", selected" : ""}`,
        }))}
    />
  );

  const right = (
    <>
      {searchExpanded ? (
        <div
          className="flex items-center gap-1 animate-fade-in"
          data-testid="eval-search-expanded"
        >
          <input
            ref={searchInputRef}
            type="text"
            value={searchInputValue}
            onChange={(e) => setSearchInputValue(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search feedback…"
            className="w-36 sm:w-48 md:w-56 px-3 py-1.5 text-sm bg-theme-surface-muted rounded-md text-theme-text placeholder:text-theme-muted border border-theme-border focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:border-brand-500 transition-all"
            aria-label="Search feedback"
          />
          <button
            type="button"
            onClick={handleSearchClose}
            className="p-1.5 min-h-[32px] min-w-[32px] rounded-sm text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle transition-colors inline-flex items-center justify-center"
            aria-label="Close search"
            data-testid="eval-search-close"
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
          className="p-1.5 min-h-[32px] min-w-[32px] rounded-sm text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle transition-colors inline-flex items-center justify-center"
          aria-label="Expand search"
          data-testid="eval-search-expand"
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
    </>
  );

  return (
    <FilterBar variant="phase" left={left} right={right} dataTestId="eval-feedback-filter-toolbar" />
  );
}
