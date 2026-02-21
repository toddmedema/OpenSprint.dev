/**
 * Shared collapsible section header and content wrapper.
 * Used by Description, Source Feedback, and Live Output sections in the task detail sidebar
 * so all three have identical element structure, styling, and collapse/expand behavior.
 */
export function CollapsibleSection({
  title,
  expanded,
  onToggle,
  expandAriaLabel,
  collapseAriaLabel,
  contentId,
  headerId,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  expandAriaLabel: string;
  collapseAriaLabel: string;
  contentId: string;
  headerId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-theme-border">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-theme-border-subtle/50 transition-colors"
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-label={expanded ? collapseAriaLabel : expandAriaLabel}
        id={headerId}
      >
        <h4 className="text-xs font-medium text-theme-muted uppercase tracking-wide">{title}</h4>
        <span className="text-theme-muted text-xs">{expanded ? "▼" : "▶"}</span>
      </button>
      {expanded && (
        <div
          id={contentId}
          role="region"
          aria-labelledby={headerId}
          className="p-4 pt-0"
        >
          {children}
        </div>
      )}
    </div>
  );
}
