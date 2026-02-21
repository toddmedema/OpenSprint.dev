import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "./layout/Layout";
import { api } from "../api/client";
import { getProjectPhasePath } from "../lib/phaseRouting";
import { useAppDispatch } from "../store";
import { addNotification } from "../store/slices/notificationSlice";
import { CloseButton } from "./CloseButton";
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

function KebabIcon({ className }: { className?: string }) {
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
        d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
      />
    </svg>
  );
}

interface ProjectActionConfirmModalProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirming?: boolean;
}

function ProjectActionConfirmModal({
  title,
  message,
  onConfirm,
  onCancel,
  confirming = false,
}: ProjectActionConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-theme-overlay backdrop-blur-sm" onClick={onCancel} />
      <div
        className="relative bg-theme-surface rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
          <h2 className="text-lg font-semibold text-theme-text">{title}</h2>
          <CloseButton onClick={onCancel} ariaLabel="Close modal" />
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-theme-text">{message}</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-theme-border bg-theme-bg rounded-b-xl">
          <button type="button" onClick={onCancel} className="btn-primary" disabled={confirming}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className="btn-secondary disabled:opacity-50"
          >
            {confirming ? "Processing…" : "Proceed"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function HomeScreen() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [archiveModal, setArchiveModal] = useState<Project | null>(null);
  const [deleteModal, setDeleteModal] = useState<Project | null>(null);
  const [confirming, setConfirming] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const refreshProjects = () => {
    api.projects.list().then(setProjects).catch(console.error);
  };

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    api.projects
      .list(ac.signal)
      .then((data) => {
        if (!cancelled) setProjects(data);
      })
      .catch((err) => {
        if (!cancelled && err?.name !== "AbortError") console.error(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpenId(null);
      }
    }
    if (menuOpenId) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuOpenId]);

  const openProject = (project: Project) => {
    navigate(getProjectPhasePath(project.id, "sketch"));
  };

  const handleArchive = async () => {
    if (!archiveModal) return;
    setConfirming(true);
    try {
      await api.projects.archive(archiveModal.id);
      setArchiveModal(null);
      setMenuOpenId(null);
      refreshProjects();
    } catch (err) {
      dispatch(
        addNotification({
          message: err instanceof Error ? err.message : "Failed to archive project",
          severity: "error",
        })
      );
    } finally {
      setConfirming(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    setConfirming(true);
    try {
      await api.projects.delete(deleteModal.id);
      setDeleteModal(null);
      setMenuOpenId(null);
      refreshProjects();
    } catch (err) {
      dispatch(
        addNotification({
          message: err instanceof Error ? err.message : "Failed to delete project",
          severity: "error",
        })
      );
    } finally {
      setConfirming(false);
    }
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
                  <th className="w-24 py-3 px-4" aria-label="Actions" />
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
                    <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                      <div
                        className="relative flex items-center justify-end gap-1"
                        ref={menuOpenId === project.id ? menuRef : undefined}
                      >
                        <span className="inline-flex text-theme-muted group-hover:text-brand-600 transition-colors">
                          <OpenIcon className="w-5 h-5" />
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId(menuOpenId === project.id ? null : project.id);
                          }}
                          className="p-1.5 rounded text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle transition-colors"
                          aria-label="Project actions"
                          aria-expanded={menuOpenId === project.id}
                          aria-haspopup="menu"
                          data-testid={`project-row-menu-${project.id}`}
                        >
                          <KebabIcon className="w-5 h-5" />
                        </button>
                        {menuOpenId === project.id && (
                          <div
                            className="absolute right-0 top-full mt-1 py-1 bg-theme-surface border border-theme-border rounded-lg shadow-lg z-50 min-w-[140px]"
                            role="menu"
                            data-testid={`project-row-dropdown-${project.id}`}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setArchiveModal(project);
                                setMenuOpenId(null);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-theme-text hover:bg-theme-bg-elevated"
                            >
                              Archive
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setDeleteModal(project);
                                setMenuOpenId(null);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-theme-text hover:bg-theme-bg-elevated"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
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

      {archiveModal && (
        <ProjectActionConfirmModal
          title="Archive project"
          message="This will remove the project from the UI, but not delete its data."
          onConfirm={handleArchive}
          onCancel={() => setArchiveModal(null)}
          confirming={confirming}
        />
      )}

      {deleteModal && (
        <ProjectActionConfirmModal
          title="Delete project"
          message="This will remove the project from the UI AND delete all OpenSprint-related data from the project folder (not including beads)."
          onConfirm={handleDelete}
          onCancel={() => setDeleteModal(null)}
          confirming={confirming}
        />
      )}
    </Layout>
  );
}
