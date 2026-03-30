import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

const ACTIVE_SECTION_TOP_OFFSET = 100;

export interface SidebarSectionNavProps {
  scrollContainerRef: RefObject<HTMLElement | null>;
  sectionSelector?: string;
  onCollapseAll?: () => void;
  onExpandAll?: () => void;
  /** Fires whenever the visually-active section changes (scroll/intersection driven). */
  onActiveSectionChange?: (sectionId: string | null) => void;
}

interface SidebarSectionItem {
  id: string;
  title: string;
}

function collectSections(
  scrollEl: HTMLElement,
  sectionSelector: string
): { sections: SidebarSectionItem[]; sectionEls: HTMLElement[] } {
  const all = Array.from(scrollEl.querySelectorAll<HTMLElement>(sectionSelector));
  const seen = new Set<string>();
  const sections: SidebarSectionItem[] = [];
  const sectionEls: HTMLElement[] = [];
  for (const el of all) {
    const id = el.dataset.sidebarSectionId?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    sections.push({
      id,
      title: el.dataset.sidebarSectionTitle?.trim() || id,
    });
    sectionEls.push(el);
  }
  return { sections, sectionEls };
}

export function SidebarSectionNav({
  scrollContainerRef,
  sectionSelector = "[data-sidebar-section-id]",
  onCollapseAll,
  onExpandAll,
  onActiveSectionChange,
}: SidebarSectionNavProps) {
  const [sections, setSections] = useState<SidebarSectionItem[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const visibleSectionsRef = useRef<Map<string, { top: number; ratio: number }>>(new Map());

  const refreshSections = useCallback(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) {
      setSections([]);
      setActiveSectionId(null);
      return;
    }
    const collected = collectSections(scrollEl, sectionSelector);
    setSections(collected.sections);
    setActiveSectionId((prev) => {
      if (prev && collected.sections.some((s) => s.id === prev)) return prev;
      return collected.sections[0]?.id ?? null;
    });
  }, [scrollContainerRef, sectionSelector]);

  useEffect(() => {
    refreshSections();
  }, [refreshSections]);

  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;
    const observer = new MutationObserver(() => {
      refreshSections();
    });
    observer.observe(scrollEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-sidebar-section-id", "data-sidebar-section-title"],
    });
    return () => observer.disconnect();
  }, [scrollContainerRef, refreshSections]);

  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl || sections.length === 0) return;
    const visibleSections = visibleSectionsRef.current;
    visibleSections.clear();

    const updateActiveSection = () => {
      const entries = Array.from(visibleSections.entries());
      if (entries.length === 0) {
        setActiveSectionId((prev) =>
          prev && sections.some((s) => s.id === prev) ? prev : sections[0].id
        );
        return;
      }
      const rootRect = scrollEl.getBoundingClientRect();
      const targetTop = rootRect.top + ACTIVE_SECTION_TOP_OFFSET;
      const sorted = entries
        .filter(([, value]) => value.ratio > 0)
        .sort((a, b) => Math.abs(a[1].top - targetTop) - Math.abs(b[1].top - targetTop));
      const next = sorted[0]?.[0] ?? sections[0].id;
      setActiveSectionId(next);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.sidebarSectionId;
          if (!id) continue;
          if (entry.isIntersecting && entry.rootBounds) {
            visibleSections.set(id, {
              top: entry.boundingClientRect.top,
              ratio: entry.intersectionRatio,
            });
          } else {
            visibleSections.delete(id);
          }
        }
        updateActiveSection();
      },
      {
        root: scrollEl,
        rootMargin: "0px",
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );

    const { sectionEls } = collectSections(scrollEl, sectionSelector);
    sectionEls.forEach((el) => observer.observe(el));
    observerRef.current = observer;

    const onScroll = () => requestAnimationFrame(updateActiveSection);
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    updateActiveSection();

    return () => {
      observer.disconnect();
      observerRef.current = null;
      visibleSections.clear();
      scrollEl.removeEventListener("scroll", onScroll);
    };
  }, [scrollContainerRef, sectionSelector, sections]);

  useEffect(() => {
    onActiveSectionChange?.(activeSectionId);
  }, [activeSectionId, onActiveSectionChange]);

  const activeIndex = useMemo(() => {
    if (!activeSectionId) return -1;
    return sections.findIndex((section) => section.id === activeSectionId);
  }, [sections, activeSectionId]);

  const jumpToSection = useCallback(
    (id: string) => {
      const scrollEl = scrollContainerRef.current;
      if (!scrollEl) return;
      const target = scrollEl.querySelector<HTMLElement>(`[data-sidebar-section-id="${id}"]`);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveSectionId(id);
    },
    [scrollContainerRef]
  );

  if (sections.length < 2) return null;

  return (
    <div
      className="sticky top-0 z-10 border-b border-theme-border-subtle bg-theme-bg/95 backdrop-blur-sm px-4 py-2"
      data-testid="sidebar-section-nav"
    >
      <div className="flex items-center gap-2">
        <label htmlFor="sidebar-section-nav-select" className="sr-only">
          Jump to section
        </label>
        <select
          id="sidebar-section-nav-select"
          value={activeSectionId ?? sections[0]?.id ?? ""}
          onChange={(e) => jumpToSection(e.target.value)}
          className="min-w-0 flex-1 text-xs bg-theme-surface border border-theme-border rounded px-2 py-1 text-theme-text"
          aria-label="Jump to section"
          data-testid="sidebar-section-nav-select"
        >
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.title}
            </option>
          ))}
        </select>
        {activeIndex >= 0 && (
          <p
            className="shrink-0 text-[11px] text-theme-muted tabular-nums"
            data-testid="sidebar-section-nav-progress"
          >
            {activeIndex + 1} of {sections.length}
          </p>
        )}
        {onCollapseAll && (
          <button
            type="button"
            onClick={onCollapseAll}
            className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle transition-colors"
            aria-label="Collapse all sections"
            title="Collapse all"
            data-testid="sidebar-section-nav-collapse-all"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <path d="M8 12h8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {onExpandAll && (
          <button
            type="button"
            onClick={onExpandAll}
            className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle transition-colors"
            aria-label="Expand all sections"
            title="Expand all"
            data-testid="sidebar-section-nav-expand-all"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <path d="M8 12h8M12 8v8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
