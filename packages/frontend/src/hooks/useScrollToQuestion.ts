import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { parseDetailParams } from "../lib/phaseRouting";

/**
 * On mount and when question param changes, scrolls the element with
 * data-question-id matching the URL ?question= param into view.
 * Uses requestAnimationFrame to allow DOM to settle after async data loads.
 */
export function useScrollToQuestion(): void {
  const location = useLocation();
  const { question } = parseDetailParams(location.search);
  const prevQuestionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!question) {
      prevQuestionRef.current = null;
      return;
    }

    // Avoid re-scrolling on same question within a session (e.g. re-renders)
    if (prevQuestionRef.current === question) return;
    prevQuestionRef.current = question;

    const scrollToElement = () => {
      const el = document.querySelector(`[data-question-id="${question}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };

    // Delay to allow async content (e.g. plan chat, task detail) to render
    const t = setTimeout(() => {
      requestAnimationFrame(scrollToElement);
    }, 100);

    return () => clearTimeout(t);
  }, [question]);
}
