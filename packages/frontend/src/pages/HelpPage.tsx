import type { ProjectPhase } from "@opensprint/shared";
import { useParams, useNavigate } from "react-router-dom";
import { Layout } from "../components/layout/Layout";
import { HelpContent } from "../components/HelpContent";
import { getProjectPhasePath } from "../lib/phaseRouting";
import { useProject } from "../api/hooks";

/**
 * Full-screen Help page. Used for homepage (/help) and project view (/projects/:projectId/help).
 */
export function HelpPage() {
  const { projectId } = useParams<{ projectId?: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(projectId);

  const projectContext = project ? { id: project.id, name: project.name } : undefined;

  const handlePhaseChange = (phase: ProjectPhase) => {
    if (projectId) navigate(getProjectPhasePath(projectId, phase));
  };

  return (
    <Layout
      project={project}
      currentPhase={projectId ? "sketch" : undefined}
      onPhaseChange={projectId ? handlePhaseChange : undefined}
    >
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden" data-testid="help-page">
        <div className="max-w-4xl mx-auto w-full flex flex-col min-h-0 h-full">
          <div className="flex-1 min-h-0 flex flex-col bg-theme-surface rounded-xl border border-theme-border overflow-hidden">
            <HelpContent project={projectContext} />
          </div>
        </div>
      </div>
    </Layout>
  );
}
