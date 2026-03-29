import React from "react";

/**
 * Shared collapsible section header and content wrapper.
 * Used by Description, Source Feedback, and Live Output sections in the task detail sidebar
 * so all three have identical element structure, styling, and collapse/expand behavior.
 */
function CollapsibleSectionInner({
  title,
  expanded,
  onToggle,
  expandAriaLabel,
  collapseAriaLabel,
  contentId,
  headerId,
  contentClassName,
  containerClassName,
  sectionNavId,
  sectionNavTitle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  expandAriaLabel: string;
  collapseAriaLabel: string;
  contentId: string;
  headerId: string;
  /** Optional. Defaults to "p-4 pt-0". Use for compact sections (e.g. Description). */
  contentClassName?: string;
  /** Optional wrapper around the whole section. */
  containerClassName?: string;
  /** Optional stable id/title metadata consumed by SidebarSectionNav. */
  sectionNavId?: string;
  sectionNavTitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={containerClassName}
      {...(sectionNavId ? { "data-sidebar-section-id": sectionNavId } : {})}
      {...(sectionNavTitle ? { "data-sidebar-section-title": sectionNavTitle } : {})}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-2 text-left hover:bg-theme-border-subtle/50 transition-colors"
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-label={expanded ? collapseAriaLabel : expandAriaLabel}
        id={headerId}
      >
        <h4 className="text-xs font-medium text-theme-muted uppercase tracking-wide">{title}</h4>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`w-4 h-4 shrink-0 text-theme-muted transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
          aria-hidden="true"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      {expanded && (
        <div
          id={contentId}
          role="region"
          aria-labelledby={headerId}
          className={contentClassName ?? "p-4 pt-0"}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export const CollapsibleSection = React.memo(CollapsibleSectionInner);
