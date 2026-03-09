import { useEffect, useCallback } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { getProjectPhasePath } from "../lib/phaseRouting";
import type { ProjectPhase } from "@opensprint/shared";

const PHASE_BY_DIGIT: Record<string, ProjectPhase> = {
  "1": "sketch",
  "2": "plan",
  "3": "execute",
  "4": "eval",
  "5": "deliver",
};

function isEditableElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Registers Electron-only keyboard shortcuts when window.electron?.isElectron:
 * - 1/2/3/4/5: switch to Sketch/Plan/Execute/Evaluate/Deliver (when on a project)
 * - ~ (Backquote): go to home
 * - Escape: open settings (project settings if in a project, else global)
 */
export function ElectronShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ projectId?: string }>();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!window.electron?.isElectron) return;
      if (isEditableElement(e.target)) return;

      const key = e.key;

      // 1–5: phase tabs (only when we're under a project)
      if (key >= "1" && key <= "5") {
        const projectId = params.projectId;
        if (projectId) {
          const phase = PHASE_BY_DIGIT[key];
          if (phase) {
            e.preventDefault();
            navigate(getProjectPhasePath(projectId, phase));
          }
        }
        return;
      }

      // ~ (Backquote): home
      if (key === "`" || key === "~") {
        e.preventDefault();
        navigate("/");
        return;
      }

      // Escape: settings (project if in project, else global)
      if (key === "Escape") {
        const projectId = params.projectId;
        if (projectId) {
          e.preventDefault();
          navigate(`/projects/${projectId}/settings`);
        } else {
          e.preventDefault();
          navigate("/settings");
        }
      }
    },
    [navigate, params.projectId]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return null;
}
