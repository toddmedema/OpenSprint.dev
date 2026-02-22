import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { ActiveAgent } from "@opensprint/shared";
import type { Project } from "@opensprint/shared";
import { AGENT_ROLE_LABELS } from "@opensprint/shared";
import { api } from "../api/client";
import { getProjectPhasePath } from "../lib/phaseRouting";
import { formatUptime } from "../lib/formatting";
import { useAppDispatch } from "../store";
import { setSelectedTaskId } from "../store/slices/executeSlice";

const POLL_INTERVAL_MS = 5000;

/** z-index for dropdown portal — above Build sidebar (z-50) and Navbar (z-60) */
const DROPDOWN_Z_INDEX = 9999;

/** Icon size matching two lines of text-sm (line-height 1.25rem * 2 + mt-0.5 gap) */
const DROPDOWN_AGENT_ICON_SIZE = "2.625rem";

/** Base URL for public assets (Vite BASE_URL so icons load when app is served from a subpath) */
const ASSET_BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/*$/, "/");

const UPTIME_TICK_MS = 1000;

export interface AgentWithProject {
  project: Project;
  agent: ActiveAgent;
}

/** Compact loading spinner matching design system (border-brand-600, animate-spin) */
function LoadingSpinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <div
      className={`border-2 border-brand-600 border-t-transparent rounded-full animate-spin ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}

const phaseLabel = (phase: string) => {
  const m: Record<string, string> = {
    spec: "Sketch",
    plan: "Plan",
    execute: "Execute",
    eval: "Evaluate",
    deliver: "Deliver",
    coding: "Coding",
    review: "Review",
  };
  return m[phase] ?? phase;
};

const roleLabel = (agent: ActiveAgent) =>
  agent.role && agent.role in AGENT_ROLE_LABELS
    ? AGENT_ROLE_LABELS[agent.role as keyof typeof AGENT_ROLE_LABELS]
    : phaseLabel(agent.phase);

const getAgentIconSrc = (agent: ActiveAgent): string => {
  const role = agent.role;
  if (role && role in AGENT_ROLE_LABELS) {
    const iconName = role.replace(/_/g, "-");
    return `${ASSET_BASE}agent-icons/${iconName}.svg`;
  }
  if (agent.phase === "review") return `${ASSET_BASE}agent-icons/reviewer.svg`;
  return `${ASSET_BASE}agent-icons/coder.svg`;
};

/**
 * Running agents across all projects for the home screen navbar.
 * Renders only when at least one project exists. Second row: [Project name] [Role] [runtime].
 */
export function GlobalActiveAgentsList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [entries, setEntries] = useState<AgentWithProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null);
  const [now, setNow] = useState(() => new Date());
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const fetchAll = useCallback(async () => {
    try {
      const projectList = await api.projects.list();
      setProjects(projectList);
      if (projectList.length === 0) {
        setEntries([]);
        return;
      }
      const results = await Promise.all(
        projectList.map(async (p) => {
          try {
            const agents = await api.agents.active(p.id);
            return (Array.isArray(agents) ? agents : []).map((agent) => ({ project: p, agent }));
          } catch {
            return [];
          }
        })
      );
      setEntries(results.flat());
    } catch {
      setProjects([]);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAll]);

  useEffect(() => {
    if (open && buttonRef.current) {
      setDropdownRect(buttonRef.current.getBoundingClientRect());
    } else {
      setDropdownRect(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    fetchAll();
    const interval = setInterval(() => setNow(new Date()), UPTIME_TICK_MS);
    return () => clearInterval(interval);
  }, [open, fetchAll]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  // Only show when at least one project exists
  if (projects.length === 0) return null;

  const dropdownContent =
    open && dropdownRect ? (
      <div
        ref={dropdownRef}
        role="listbox"
        className="fixed min-w-[220px] max-h-[320px] overflow-y-auto bg-theme-surface border border-theme-border rounded-lg shadow-lg py-2"
        style={{
          top: dropdownRect.bottom + 4,
          right: window.innerWidth - dropdownRect.right,
          zIndex: DROPDOWN_Z_INDEX,
        }}
      >
        {loading ? (
          <div
            className="px-4 py-6 flex items-center justify-center"
            role="status"
            aria-label="Loading agents"
          >
            <LoadingSpinner className="w-4 h-4" />
          </div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-theme-muted">No agents running</div>
        ) : (
          <ul className="divide-y divide-theme-border-subtle">
            {entries.map(({ project, agent }) => (
              <li key={`${project.id}-${agent.id}`} role="option">
                <button
                  type="button"
                  className="w-full px-4 py-2.5 text-sm text-left hover:bg-theme-border-subtle transition-colors flex items-start gap-3"
                  onClick={() => {
                    dispatch(setSelectedTaskId(agent.id));
                    navigate(getProjectPhasePath(project.id, "execute", { task: agent.id }));
                    setOpen(false);
                  }}
                >
                  <img
                    src={getAgentIconSrc(agent)}
                    alt=""
                    className="shrink-0 object-contain object-center -mt-1"
                    style={{ width: DROPDOWN_AGENT_ICON_SIZE, height: DROPDOWN_AGENT_ICON_SIZE }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-theme-text">{agent.label || agent.id}</div>
                    <div className="text-theme-muted mt-0.5">
                      {project.name} · {roleLabel(agent)} ·{" "}
                      <span className="text-theme-muted tabular-nums">
                        {agent.startedAt ? formatUptime(agent.startedAt, now) : "—"}
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    ) : null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border-none ring-0 bg-transparent hover:bg-theme-border-subtle focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 text-theme-text transition-colors"
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Active agents"
      >
        <span className="min-w-[7.5rem] inline-flex items-center justify-center">
          {loading ? (
            <LoadingSpinner className="w-4 h-4" />
          ) : entries.length > 0 ? (
            `${entries.length} agent${entries.length === 1 ? "" : "s"} running`
          ) : (
            "No agents running"
          )}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {dropdownContent && createPortal(dropdownContent, document.body)}
    </div>
  );
}
