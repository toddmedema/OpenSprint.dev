import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Stable section keys for the Execute task detail sidebar.
 * These abstract over per-task sectionNavIds so section focus
 * can be restored when switching between tasks.
 */
export const SIDEBAR_SECTION_KEYS = {
  DESCRIPTION: "execute-description-section",
  DIAGNOSTICS: "execute-diagnostics-section",
  ARTIFACTS: "execute-artifacts-section",
  CHAT: "execute-chat-section",
} as const;

const SOURCE_FEEDBACK_PREFIX = "source-feedback-";
const STABLE_FEEDBACK_KEY = "source-feedback";

/** Maps a concrete sectionNavId to a stable key for cross-task restoration. */
export function toStableKey(sectionNavId: string): string {
  if (sectionNavId.startsWith(SOURCE_FEEDBACK_PREFIX)) return STABLE_FEEDBACK_KEY;
  return sectionNavId;
}

/** Find a section element by stable key in the scroll container. */
function findSectionElement(scrollEl: HTMLElement, stableKey: string): HTMLElement | null {
  const exact = scrollEl.querySelector<HTMLElement>(`[data-sidebar-section-id="${stableKey}"]`);
  if (exact) return exact;

  if (stableKey === STABLE_FEEDBACK_KEY) {
    return scrollEl.querySelector<HTMLElement>(
      `[data-sidebar-section-id^="${SOURCE_FEEDBACK_PREFIX}"]`
    );
  }

  return null;
}

export interface UseSidebarSectionRestoreOptions {
  scrollContainerRef: RefObject<HTMLElement | null>;
  selectedTask: string;
}

/**
 * Remembers which sidebar section was active when the user switches tasks,
 * then scrolls that same section into view for the new task. Falls back to
 * the first available section (or scroll-top) if the target is absent.
 */
export function useSidebarSectionRestore({
  scrollContainerRef,
  selectedTask,
}: UseSidebarSectionRestoreOptions) {
  const activeSectionRef = useRef<string | null>(null);
  const restoreTargetRef = useRef<string | null>(null);
  const prevTaskRef = useRef<string>(selectedTask);

  const handleActiveSectionChange = useCallback((sectionId: string | null) => {
    activeSectionRef.current = sectionId;
  }, []);

  useLayoutEffect(() => {
    if (prevTaskRef.current === selectedTask) return;
    restoreTargetRef.current = activeSectionRef.current
      ? toStableKey(activeSectionRef.current)
      : null;
    prevTaskRef.current = selectedTask;
  }, [selectedTask]);

  useEffect(() => {
    const target = restoreTargetRef.current;
    if (!target) return;

    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) {
      restoreTargetRef.current = null;
      return;
    }

    const rafId = requestAnimationFrame(() => {
      const el = findSectionElement(scrollEl, target);
      if (el) {
        el.scrollIntoView({ behavior: "instant", block: "start" });
      } else {
        const first = scrollEl.querySelector<HTMLElement>("[data-sidebar-section-id]");
        if (first) {
          first.scrollIntoView({ behavior: "instant", block: "start" });
        } else {
          scrollEl.scrollTop = 0;
        }
      }
      restoreTargetRef.current = null;
    });

    return () => cancelAnimationFrame(rafId);
  }, [selectedTask, scrollContainerRef]);

  return { handleActiveSectionChange };
}
