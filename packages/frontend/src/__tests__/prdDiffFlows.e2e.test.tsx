/**
 * E2E: PRD diff flows — (1) pending PRD HIL approval: proposed diff loads, rendered view,
 * toggle raw, approve. (2) Sketch change history: View Diff → modal loads diff, toggle modes, close.
 */
import type React from "react";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HilApprovalBlock } from "../components/HilApprovalBlock";
import { PrdChangeLog, type PrdHistoryEntry } from "../components/prd/PrdChangeLog";

const mockGetProposedDiff = vi.fn();
const mockNotificationsResolve = vi.fn();
const mockPrdGet = vi.fn();
const mockGetVersionDiff = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    notifications: {
      resolve: (...args: unknown[]) => mockNotificationsResolve(...args),
    },
    prd: {
      get: (...args: unknown[]) => mockPrdGet(...args),
      getProposedDiff: (...args: unknown[]) => mockGetProposedDiff(...args),
      getVersionDiff: (...args: unknown[]) => mockGetVersionDiff(...args),
    },
  },
  isApiError: vi.fn(() => false),
}));

const PROJECT_ID = "proj-prd-diff-e2e";

const baseHilNotification = {
  id: "hil-prd-diff-e2e",
  projectId: PROJECT_ID,
  source: "eval" as const,
  sourceId: "fb-1",
  questions: [{ id: "q1", text: "Approve this PRD update?", createdAt: "2026-01-01T00:00:00Z" }],
  status: "open" as const,
  createdAt: "2026-01-01T00:00:00Z",
  resolvedAt: null,
  kind: "hil_approval" as const,
};

const prdScopeNotification = {
  ...baseHilNotification,
  scopeChangeMetadata: {
    scopeChangeSummary: "• goals: Update goals",
    scopeChangeProposedUpdates: [
      {
        section: "goals",
        changeLogEntry: "Clarify MVP scope",
        content: "Ship web first.",
      },
    ],
  },
};

const proposedDiffApiPayload = {
  requestId: prdScopeNotification.id,
  fromContent: "# Product\n\nOld paragraph.",
  toContent: "# Product\n\nNew paragraph.",
  diff: {
    lines: [
      { type: "context" as const, text: "# Product", oldLineNumber: 1, newLineNumber: 1 },
      { type: "remove" as const, text: "Old paragraph.", oldLineNumber: 2 },
      { type: "add" as const, text: "New paragraph.", newLineNumber: 2 },
    ],
    summary: { additions: 1, deletions: 1 },
    pagination: { totalLines: 3, offset: 0, limit: 500, hasMore: false },
  },
};

const historyEntry: PrdHistoryEntry = {
  section: "problem_statement",
  version: 2,
  timestamp: "2026-01-15T12:00:00Z",
  source: "sketch",
  diff: "Refined problem",
  documentVersion: 3,
};

const versionDiffApiPayload = {
  fromVersion: "3",
  toVersion: "current",
  fromContent: "# Spec\n\nVersion three.",
  toContent: "# Spec\n\nCurrent draft.",
  diff: {
    lines: [
      { type: "context" as const, text: "# Spec", oldLineNumber: 1, newLineNumber: 1 },
      { type: "remove" as const, text: "Version three.", oldLineNumber: 2 },
      { type: "add" as const, text: "Current draft.", newLineNumber: 2 },
    ],
    summary: { additions: 1, deletions: 1 },
    pagination: { totalLines: 3, offset: 0, limit: 500, hasMore: false },
  },
};

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("E2E: PRD diff flows (HIL approval + sketch history)", () => {
  beforeAll(() => {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockNotificationsResolve.mockResolvedValue({} as never);
    mockPrdGet.mockResolvedValue({ sections: {}, version: 1, changeLog: [] } as never);
    mockGetProposedDiff.mockResolvedValue(proposedDiffApiPayload as never);
    mockGetVersionDiff.mockResolvedValue(versionDiffApiPayload as never);
  });

  it("pending PRD HIL: shows rendered proposed diff, toggles raw mode, approves", async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();

    renderWithQuery(
      <HilApprovalBlock
        notification={prdScopeNotification}
        projectId={PROJECT_ID}
        onResolved={onResolved}
      />
    );

    await screen.findByText("Proposed PRD changes");
    await waitFor(() => {
      expect(screen.queryByTestId("hil-diff-loading")).not.toBeInTheDocument();
    });

    await screen.findByTestId("diff-view");
    await screen.findByTestId("diff-view-rendered", {}, { timeout: 15_000 });

    expect(screen.getByTestId("diff-view-summary")).toHaveTextContent("+1 −1");

    await user.click(screen.getByRole("radio", { name: /Raw/i }));
    expect(screen.getByTestId("diff-view-raw")).toBeInTheDocument();
    expect(screen.getByTestId("line-marker-2")).toHaveTextContent("+");

    await user.click(screen.getByRole("radio", { name: /Rendered/i }));
    await screen.findByTestId("diff-view-rendered");

    await user.click(screen.getByTestId("hil-approve-btn"));

    await waitFor(() => {
      expect(mockNotificationsResolve).toHaveBeenCalledWith(PROJECT_ID, prdScopeNotification.id, {
        approved: true,
      });
    });
    expect(onResolved).toHaveBeenCalled();
  });

  it("sketch change history: View Diff opens modal, diff loads, toggles modes, closes", async () => {
    const user = userEvent.setup();

    renderWithQuery(
      <PrdChangeLog
        projectId={PROJECT_ID}
        entries={[historyEntry]}
        expanded
        onToggle={() => {}}
      />
    );

    await user.click(screen.getByTestId("prd-version-view-diff"));

    await screen.findByTestId("version-diff-modal-content");
    expect(screen.getByText("Diff: v3 → current")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByTestId("version-diff-loading")).not.toBeInTheDocument();
    });

    await screen.findByTestId("diff-view-rendered", {}, { timeout: 15_000 });

    await user.click(screen.getByRole("radio", { name: /Raw/i }));
    expect(screen.getByTestId("diff-view-raw")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Rendered/i }));
    await screen.findByTestId("diff-view-rendered");

    await user.click(screen.getByTestId("version-diff-modal-close"));
    await waitFor(() => {
      expect(screen.queryByTestId("version-diff-modal-content")).not.toBeInTheDocument();
    });

    expect(mockGetVersionDiff).toHaveBeenCalledWith(PROJECT_ID, "3", undefined, {
      lineOffset: 0,
    });
  });
});
