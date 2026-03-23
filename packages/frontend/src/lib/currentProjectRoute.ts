import type { ProjectPhase } from "@opensprint/shared";
import { isValidPhaseSlug } from "./phaseRouting";

export interface CurrentProjectRoute {
  projectId: string | null;
  phase: ProjectPhase | null;
}

export function getCurrentProjectRoute(pathname?: string): CurrentProjectRoute {
  const browserPathname =
    typeof window !== "undefined"
      ? ((window as unknown as { location?: { pathname?: string } }).location?.pathname ?? "")
      : "";
  const resolvedPathname = pathname ?? browserPathname;
  const segments = resolvedPathname.split("/").filter(Boolean);

  if (segments[0] !== "projects") {
    return { projectId: null, phase: null };
  }

  const projectId = segments[1] ?? null;
  if (!projectId || projectId === "create-new" || projectId === "add-existing") {
    return { projectId: null, phase: null };
  }

  const maybePhase = segments[2];
  return {
    projectId,
    phase: isValidPhaseSlug(maybePhase) ? maybePhase : null,
  };
}

export function isViewingProjectPhase(
  projectId: string,
  phase: ProjectPhase,
  pathname?: string
): boolean {
  const currentRoute = getCurrentProjectRoute(pathname);
  return currentRoute.projectId === projectId && currentRoute.phase === phase;
}
