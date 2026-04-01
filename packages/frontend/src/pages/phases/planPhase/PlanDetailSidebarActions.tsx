import { useEffect, useRef, useState } from "react";
import { CloseButton } from "../../../components/CloseButton";
import { shouldRightAlignDropdown } from "../../../lib/dropdownViewport";

export function PlanDetailSidebarActions({
  planId,
  archivingPlanId,
  deletingPlanId,
  onArchive,
  onRequestDelete,
  onClosePanel,
}: {
  planId: string;
  archivingPlanId: string | null;
  deletingPlanId: string | null;
  onArchive: (planId: string) => void;
  onRequestDelete: (planId: string) => void;
  onClosePanel: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [alignRight, setAlignRight] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [planId]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen && triggerRef.current) {
      setAlignRight(shouldRightAlignDropdown(triggerRef.current.getBoundingClientRect()));
    }
  }, [menuOpen]);

  return (
    <>
      <div ref={menuRef} className="relative shrink-0">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="p-1.5 rounded-md text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle transition-colors"
          aria-label="Plan actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-testid="plan-sidebar-actions-menu-trigger"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
          </svg>
        </button>
        {menuOpen && (
          <ul
            role="menu"
            className={`dropdown-menu-elevated dropdown-menu-surface absolute top-full mt-1 min-w-[140px] ${alignRight ? "right-0 left-auto" : "left-0 right-auto"}`}
            data-testid="plan-sidebar-actions-menu"
          >
            <li role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onArchive(planId);
                  setMenuOpen(false);
                }}
                disabled={!!archivingPlanId}
                className="dropdown-item w-full flex items-center gap-2 text-left text-xs text-theme-text hover:bg-theme-border-subtle/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="plan-sidebar-archive-btn"
              >
                {archivingPlanId ? "Archiving…" : "Archive"}
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onRequestDelete(planId);
                  setMenuOpen(false);
                }}
                disabled={!!deletingPlanId}
                className="dropdown-item w-full flex items-center gap-2 text-left text-xs text-theme-error-text hover:bg-theme-error-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="plan-sidebar-delete-btn"
              >
                {deletingPlanId ? "Deleting…" : "Delete"}
              </button>
            </li>
          </ul>
        )}
      </div>
      <CloseButton onClick={onClosePanel} ariaLabel="Close plan panel" />
    </>
  );
}
