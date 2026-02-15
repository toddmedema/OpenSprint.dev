import { useParams, useNavigate } from 'react-router-dom';
import type { ProjectPhase } from '@opensprint/shared';

const VALID_PHASES: ProjectPhase[] = ['design', 'plan', 'build', 'validate'];

function phaseFromSlug(slug: string | undefined): ProjectPhase {
  if (slug && VALID_PHASES.includes(slug as ProjectPhase)) return slug as ProjectPhase;
  return 'design';
}
import { Layout } from '../components/layout/Layout';
import { HilApprovalModal } from '../components/HilApprovalModal';
import { ProjectWebSocketProvider, useProjectWebSocket } from '../contexts/ProjectWebSocketContext';
import { useProject } from '../hooks/useProject';
import { DesignPhase } from './phases/DesignPhase';
import { PlanPhase } from './phases/PlanPhase';
import { BuildPhase } from './phases/BuildPhase';
import { ValidatePhase } from './phases/ValidatePhase';

const CATEGORY_LABELS: Record<string, string> = {
  scopeChanges: "Scope Changes",
  architectureDecisions: "Architecture Decisions",
  dependencyModifications: "Dependency Modifications",
  testFailuresAndRetries: "Test Failures & Retries",
};

function ProjectContent() {
  const { projectId, phase: phaseSlug } = useParams<{ projectId: string; phase?: string }>();
  const navigate = useNavigate();
  const { project, loading, error } = useProject(projectId!);
  const currentPhase = phaseFromSlug(phaseSlug);
  const { hilRequest, hilNotification, respondToHil, clearHilNotification } = useProjectWebSocket();

  const handlePhaseChange = (phase: ProjectPhase) => {
    const path = phase === 'design' ? `/projects/${projectId}` : `/projects/${projectId}/${phase}`;
    navigate(path);
  };

  if (loading) {
    return (
      <>
        <Layout>
          <div className="flex items-center justify-center h-full text-gray-400">
            Loading project...
          </div>
        </Layout>
        {hilRequest && <HilApprovalModal request={hilRequest} onRespond={respondToHil} />}
        {hilNotification && (
          <div className="fixed bottom-4 right-4 z-40 max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {CATEGORY_LABELS[hilNotification.category] ?? hilNotification.category}
                </p>
                <p className="mt-1 text-sm text-gray-600">{hilNotification.description}</p>
                <p className="mt-2 text-xs text-gray-500">Proceeding automatically.</p>
              </div>
              <button type="button" onClick={clearHilNotification} className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Dismiss">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  if (error || !project) {
    return (
      <>
        <Layout>
          <div className="flex items-center justify-center h-full text-red-500">
            {error ?? 'Project not found'}
          </div>
        </Layout>
        {hilRequest && <HilApprovalModal request={hilRequest} onRespond={respondToHil} />}
        {hilNotification && (
          <div className="fixed bottom-4 right-4 z-40 max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {CATEGORY_LABELS[hilNotification.category] ?? hilNotification.category}
                </p>
                <p className="mt-1 text-sm text-gray-600">{hilNotification.description}</p>
                <p className="mt-2 text-xs text-gray-500">Proceeding automatically.</p>
              </div>
              <button type="button" onClick={clearHilNotification} className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Dismiss">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  const phaseComponents: Record<ProjectPhase, React.ReactNode> = {
    design: <DesignPhase projectId={projectId!} />,
    plan: <PlanPhase projectId={projectId!} />,
    build: <BuildPhase projectId={projectId!} />,
    validate: <ValidatePhase projectId={projectId!} />,
  };

  return (
    <>
      <Layout
        project={project}
        currentPhase={currentPhase}
        onPhaseChange={handlePhaseChange}
      >
        {phaseComponents[currentPhase]}
      </Layout>
      {hilRequest && (
        <HilApprovalModal
          request={hilRequest}
          onRespond={respondToHil}
        />
      )}
      {hilNotification && (
        <div className="fixed bottom-4 right-4 z-40 max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-900">
                {CATEGORY_LABELS[hilNotification.category] ?? hilNotification.category}
              </p>
              <p className="mt-1 text-sm text-gray-600">{hilNotification.description}</p>
              <p className="mt-2 text-xs text-gray-500">Proceeding automatically. You can review in the log.</p>
            </div>
            <button
              type="button"
              onClick={clearHilNotification}
              className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Dismiss"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  return (
    <ProjectWebSocketProvider projectId={projectId}>
      <ProjectContent />
    </ProjectWebSocketProvider>
  );
}
