import type { ReactNode } from "react";
import type { Project, ProjectPhase } from "@opensprint/shared";
import { Navbar } from "./Navbar";
import { NotificationBar } from "../NotificationBar";
import { ConnectionErrorBanner } from "../ConnectionErrorBanner";
import { DatabaseStatusBanner } from "../DatabaseStatusBanner";

interface LayoutProps {
  children: ReactNode;
  project?: Project | null;
  currentPhase?: ProjectPhase;
  onPhaseChange?: (phase: ProjectPhase) => void;
  onProjectSaved?: () => void;
}

export function Layout({
  children,
  project,
  currentPhase,
  onPhaseChange,
  onProjectSaved,
}: LayoutProps) {
  return (
    <div className="h-full flex flex-col bg-theme-bg">
      <a
        href="#main"
        className="absolute left-4 -top-16 z-[9999] px-4 py-2 rounded shadow bg-theme-bg text-theme-fg transition-[top] duration-150 focus:top-4 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
      >
        Skip to main content
      </a>
      <ConnectionErrorBanner />
      <DatabaseStatusBanner />
      <Navbar
        project={project}
        currentPhase={currentPhase}
        onPhaseChange={onPhaseChange}
        onProjectSaved={onProjectSaved}
      />
      <NotificationBar />
      <main id="main" className="flex-1 min-h-0 flex flex-col overflow-hidden bg-theme-bg">{children}</main>
    </div>
  );
}
