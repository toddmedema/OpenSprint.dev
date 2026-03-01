import { useOutletContext, useNavigate } from "react-router-dom";
import { ProjectSettingsModal } from "../components/ProjectSettingsModal";
import { getProjectPhasePath } from "../lib/phaseRouting";
import { queryKeys } from "../api/queryKeys";
import { useQueryClient } from "@tanstack/react-query";
import type { ProjectShellContext } from "./ProjectShell";

/**
 * Project Settings page content. Renders inside ProjectShell's Layout.
 * Project state (tasks, plans, feedback) remains in Redux while viewing Settings.
 */
export function ProjectSettingsContent() {
  const { projectId, project } = useOutletContext<ProjectShellContext>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleClose = () => {
    navigate(getProjectPhasePath(projectId, "sketch"));
  };

  const handleSaved = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
    handleClose();
  };

  return (
    <div
      className="flex-1 min-h-0 overflow-hidden flex flex-col px-6 py-6"
      data-testid="project-settings-page"
    >
      <ProjectSettingsModal
        project={project}
        onClose={handleClose}
        onSaved={handleSaved}
        fullScreen
      />
    </div>
  );
}
