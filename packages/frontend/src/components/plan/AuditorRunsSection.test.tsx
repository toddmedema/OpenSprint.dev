import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders } from "../../test/test-utils";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuditorRunsSection } from "./AuditorRunsSection";
import { api } from "../../api/client";

vi.mock("../../api/client", () => ({
  api: {
    plans: {
      auditorRuns: vi.fn(),
    },
  },
}));

describe("AuditorRunsSection", () => {
  beforeEach(() => {
    vi.mocked(api.plans.auditorRuns).mockReset();
  });

  it("shows loading state while fetching", async () => {
    vi.mocked(api.plans.auditorRuns).mockImplementation(
      () => new Promise(() => {}) // never resolves
    );
    renderWithProviders(<AuditorRunsSection projectId="proj-1" planId="plan-a" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows empty state when no runs", async () => {
    vi.mocked(api.plans.auditorRuns).mockResolvedValue([]);
    renderWithProviders(<AuditorRunsSection projectId="proj-1" planId="plan-a" />);
    await vi.waitFor(() => {
      expect(screen.getByTestId("auditor-runs-section")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/No Auditor runs yet/)
    ).toBeInTheDocument();
  });

  it("lists past Auditor runs with expandable logs", async () => {
    const runs = [
      {
        id: 1,
        projectId: "proj-1",
        planId: "plan-a",
        epicId: "epic-1",
        startedAt: "2025-03-01T10:00:00Z",
        completedAt: "2025-03-01T10:05:00Z",
        status: "pass",
        assessment: "Implementation meets plan scope. No significant issues found.",
      },
      {
        id: 2,
        projectId: "proj-1",
        planId: "plan-a",
        epicId: "epic-1",
        startedAt: "2025-03-02T14:00:00Z",
        completedAt: "2025-03-02T14:08:00Z",
        status: "issues",
        assessment: "Found gaps in test coverage. Proposed 2 tasks.",
      },
    ];
    vi.mocked(api.plans.auditorRuns).mockResolvedValue(runs);
    renderWithProviders(<AuditorRunsSection projectId="proj-1" planId="plan-a" />);

    await vi.waitFor(() => {
      expect(screen.getByText("Auditor runs (2)")).toBeInTheDocument();
    });

    expect(screen.getByTestId("auditor-run-1")).toBeInTheDocument();
    expect(screen.getByTestId("auditor-run-2")).toBeInTheDocument();

    // Expand first run
    const user = userEvent.setup();
    const firstRun = screen.getByTestId("auditor-run-1");
    const expandBtn = firstRun.querySelector("button");
    expect(expandBtn).toBeTruthy();
    await user.click(expandBtn!);

    expect(screen.getByText(/Implementation meets plan scope/)).toBeInTheDocument();

    // Expand second run
    const secondRun = screen.getByTestId("auditor-run-2");
    const expandBtn2 = secondRun.querySelector("button");
    await user.click(expandBtn2!);

    expect(screen.getByText(/Found gaps in test coverage/)).toBeInTheDocument();
  });

  it("shows 'No assessment recorded' when assessment is null", async () => {
    vi.mocked(api.plans.auditorRuns).mockResolvedValue([
      {
        id: 1,
        projectId: "proj-1",
        planId: "plan-a",
        epicId: "epic-1",
        startedAt: "2025-03-01T10:00:00Z",
        completedAt: "2025-03-01T10:05:00Z",
        status: "pass",
        assessment: null,
      },
    ]);
    renderWithProviders(<AuditorRunsSection projectId="proj-1" planId="plan-a" />);

    await vi.waitFor(() => {
      expect(screen.getByTestId("auditor-run-1")).toBeInTheDocument();
    });

    const run = screen.getByTestId("auditor-run-1");
    const expandBtn = run.querySelector("button");
    await userEvent.click(expandBtn!);

    expect(screen.getByText(/No assessment recorded/)).toBeInTheDocument();
  });
});
