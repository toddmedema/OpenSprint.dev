import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "./layout/Layout";
import { api } from "../api/client";
import { getProjectPhasePath } from "../lib/phaseRouting";
import type { Project } from "@opensprint/shared";

function OpenIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
      />
    </svg>
  );
}

export function HomeScreen() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.projects
      .list()
      .then(setProjects)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const openProject = (project: Project) => {
    navigate(getProjectPhasePath(project.id, "sketch"));
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-theme-text">Projects</h1>
          <p className="mt-1 text-theme-muted">Manage your AI-powered development projects</p>
        </div>

        {loading ? (
          <div className="text-center py-20 text-theme-muted">Loading projects...</div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full" data-testid="projects-table">
              <thead>
                <tr className="border-b border-theme-border bg-theme-bg-elevated">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-theme-text">
                    Name
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-theme-text">
                    Folder path
                  </th>
                  <th className="w-12 py-3 px-4" aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr
                    key={project.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openProject(project)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openProject(project);
                      }
                    }}
                    className="group border-b border-theme-border last:border-b-0 hover:bg-theme-bg-elevated cursor-pointer transition-colors"
                    data-testid={`project-row-${project.id}`}
                  >
                    <td className="py-3 px-4 text-theme-text font-medium">{project.name}</td>
                    <td className="py-3 px-4 text-sm text-theme-muted truncate max-w-md">
                      {project.repoPath}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex text-theme-muted group-hover:text-brand-600 transition-colors">
                        <OpenIcon className="w-5 h-5" />
                      </span>
                    </td>
                  </tr>
                ))}
                <tr
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate("/projects/new")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate("/projects/new");
                    }
                  }}
                  className="bg-theme-bg-elevated/50 hover:bg-theme-bg-elevated cursor-pointer transition-colors"
                  data-testid="create-project-row"
                >
                  <td colSpan={3} className="py-3 px-4 text-sm font-medium text-theme-muted">
                    + Create project
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
