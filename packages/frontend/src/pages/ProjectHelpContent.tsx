import { useOutletContext } from "react-router-dom";
import { HelpContent } from "../components/HelpContent";
import type { ProjectShellContext } from "./ProjectShell";

/**
 * Help page content for project view. Renders inside ProjectShell's Layout.
 * Project state (tasks, plans, feedback) remains in Redux while viewing Help.
 */
export function ProjectHelpContent() {
  const { project } = useOutletContext<ProjectShellContext>();
  const projectContext = { id: project.id, name: project.name };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden" data-testid="help-page">
      <div className="max-w-4xl mx-auto w-full flex flex-col min-h-0 h-full">
        <div className="flex-1 min-h-0 flex flex-col bg-theme-surface rounded-xl border border-theme-border overflow-hidden">
          <HelpContent project={projectContext} />
        </div>
      </div>
    </div>
  );
}
