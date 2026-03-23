import { describe, it, expect } from "vitest";
import { getCurrentProjectRoute, isViewingProjectPhase } from "./currentProjectRoute";

describe("currentProjectRoute", () => {
  it("returns null route for non-project pages", () => {
    expect(getCurrentProjectRoute("/")).toEqual({ projectId: null, phase: null });
    expect(getCurrentProjectRoute("/settings")).toEqual({ projectId: null, phase: null });
    expect(getCurrentProjectRoute("/help")).toEqual({ projectId: null, phase: null });
  });

  it("parses project phase routes", () => {
    expect(getCurrentProjectRoute("/projects/proj-1/plan")).toEqual({
      projectId: "proj-1",
      phase: "plan",
    });
    expect(getCurrentProjectRoute("/projects/proj-1/execute")).toEqual({
      projectId: "proj-1",
      phase: "execute",
    });
  });

  it("treats project settings/help as project routes without a phase", () => {
    expect(getCurrentProjectRoute("/projects/proj-1/settings")).toEqual({
      projectId: "proj-1",
      phase: null,
    });
    expect(getCurrentProjectRoute("/projects/proj-1/help")).toEqual({
      projectId: "proj-1",
      phase: null,
    });
  });

  it("ignores create and add-existing pseudo-project routes", () => {
    expect(getCurrentProjectRoute("/projects/create-new")).toEqual({
      projectId: null,
      phase: null,
    });
    expect(getCurrentProjectRoute("/projects/add-existing")).toEqual({
      projectId: null,
      phase: null,
    });
  });

  it("checks whether the current pathname is the requested project phase", () => {
    expect(isViewingProjectPhase("proj-1", "plan", "/projects/proj-1/plan")).toBe(true);
    expect(isViewingProjectPhase("proj-1", "plan", "/projects/proj-1/sketch")).toBe(false);
    expect(isViewingProjectPhase("proj-1", "plan", "/projects/proj-2/plan")).toBe(false);
    expect(isViewingProjectPhase("proj-1", "plan", "/projects/proj-1/settings")).toBe(false);
  });
});
