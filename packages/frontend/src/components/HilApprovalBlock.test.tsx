import type React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HilApprovalBlock } from "./HilApprovalBlock";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    notifications: {
      resolve: vi.fn(),
    },
    prd: {
      get: vi.fn(),
      getProposedDiff: vi.fn(),
    },
  },
  isApiError: vi.fn(() => false),
}));

function renderWithProviders(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const mockNotification = {
  id: "hil-abc123",
  projectId: "proj-1",
  source: "eval" as const,
  sourceId: "fb-1",
  questions: [{ id: "q1", text: "Approve this scope change?", createdAt: "2025-01-01T00:00:00Z" }],
  status: "open" as const,
  createdAt: "2025-01-01T00:00:00Z",
  resolvedAt: null,
  kind: "hil_approval" as const,
};

describe("HilApprovalBlock", () => {
  beforeEach(() => {
    vi.mocked(api.notifications.resolve).mockResolvedValue({} as never);
    vi.mocked(api.prd.get).mockResolvedValue({ sections: {}, version: 1, changeLog: [] } as never);
    vi.mocked(api.prd.getProposedDiff).mockRejectedValue(new Error("proposed-diff not available"));
  });

  it("renders approval required with Approve and Reject buttons", () => {
    const onResolved = vi.fn();
    renderWithProviders(
      <HilApprovalBlock
        notification={mockNotification}
        projectId="proj-1"
        onResolved={onResolved}
      />
    );

    expect(screen.getByText("Approval required")).toBeInTheDocument();
    expect(screen.getByText("Approve this scope change?")).toBeInTheDocument();
    expect(screen.getByTestId("hil-approve-btn")).toBeInTheDocument();
    expect(screen.getByTestId("hil-reject-btn")).toBeInTheDocument();
  });

  it("calls resolve with approved: true when Approve is clicked", async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();
    renderWithProviders(
      <HilApprovalBlock
        notification={mockNotification}
        projectId="proj-1"
        onResolved={onResolved}
      />
    );

    await user.click(screen.getByTestId("hil-approve-btn"));

    await waitFor(() => {
      expect(api.notifications.resolve).toHaveBeenCalledWith("proj-1", "hil-abc123", {
        approved: true,
      });
    });
    await waitFor(() => {
      expect(onResolved).toHaveBeenCalled();
    });
  });

  it("calls resolve with approved: false when Reject is clicked", async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();
    renderWithProviders(
      <HilApprovalBlock
        notification={mockNotification}
        projectId="proj-1"
        onResolved={onResolved}
      />
    );

    await user.click(screen.getByTestId("hil-reject-btn"));

    await waitFor(() => {
      expect(api.notifications.resolve).toHaveBeenCalledWith("proj-1", "hil-abc123", {
        approved: false,
      });
    });
    await waitFor(() => {
      expect(onResolved).toHaveBeenCalled();
    });
  });

  it("shows DiffView when scopeChangeMetadata is present and proposed-diff succeeds", async () => {
    vi.mocked(api.prd.getProposedDiff).mockResolvedValue({
      requestId: "hil-abc123",
      fromContent: "# SPEC\n",
      toContent: "# SPEC\n\n## New section\n",
      diff: {
        lines: [
          { type: "context" as const, text: "# SPEC", oldLineNumber: 1, newLineNumber: 1 },
          { type: "add" as const, text: "## New section", newLineNumber: 2 },
        ],
        summary: { additions: 1, deletions: 0 },
        pagination: { totalLines: 2, offset: 0, limit: 2, hasMore: false },
      },
    } as never);
    const notificationWithDiff = {
      ...mockNotification,
      scopeChangeMetadata: {
        scopeChangeSummary: "• feature_list: Add mobile app",
        scopeChangeProposedUpdates: [
          {
            section: "feature_list",
            changeLogEntry: "Add mobile app",
            content: "1. Web dashboard\n2. Mobile app",
          },
        ],
      },
    };
    renderWithProviders(
      <HilApprovalBlock
        notification={notificationWithDiff}
        projectId="proj-1"
        onResolved={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Proposed PRD changes")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("diff-view")).toBeInTheDocument();
    });
  });

  it("shows DiffView in raw mode when proposed-diff returns lines without full document content", async () => {
    vi.mocked(api.prd.getProposedDiff).mockResolvedValue({
      requestId: "hil-abc123",
      diff: {
        lines: [
          { type: "context" as const, text: "# SPEC", oldLineNumber: 1, newLineNumber: 1 },
          { type: "add" as const, text: "## New section", newLineNumber: 2 },
        ],
        summary: { additions: 1, deletions: 0 },
        pagination: { totalLines: 2, offset: 0, limit: 2, hasMore: false },
      },
    } as never);
    const notificationWithDiff = {
      ...mockNotification,
      scopeChangeMetadata: {
        scopeChangeSummary: "• feature_list: Add mobile app",
        scopeChangeProposedUpdates: [
          {
            section: "feature_list",
            changeLogEntry: "Add mobile app",
            content: "1. Web dashboard\n2. Mobile app",
          },
        ],
      },
    };
    renderWithProviders(
      <HilApprovalBlock
        notification={notificationWithDiff}
        projectId="proj-1"
        onResolved={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("diff-view")).toBeInTheDocument();
    });
    expect(screen.getByText("Proposed PRD changes")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Diff lines" })).toHaveTextContent(/## New section/);
    expect(screen.getByTestId("hil-approve-btn")).toBeInTheDocument();
    expect(screen.getByTestId("hil-reject-btn")).toBeInTheDocument();
  });

  it("shows loading state while proposed-diff is in flight", async () => {
    vi.mocked(api.prd.getProposedDiff).mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      })
    );
    const notificationWithDiff = {
      ...mockNotification,
      scopeChangeMetadata: {
        scopeChangeSummary: "• feature_list: Add mobile app",
        scopeChangeProposedUpdates: [
          {
            section: "feature_list",
            changeLogEntry: "Add mobile app",
            content: "1. Web dashboard\n2. Mobile app",
          },
        ],
      },
    };
    renderWithProviders(
      <HilApprovalBlock
        notification={notificationWithDiff}
        projectId="proj-1"
        onResolved={vi.fn()}
      />
    );
    expect(await screen.findByTestId("hil-diff-loading")).toHaveTextContent(
      "Loading proposed changes…"
    );
    expect(screen.queryByTestId("diff-view")).not.toBeInTheDocument();
  });

  it("shows No changes and Approve/Reject when proposed-diff returns empty diff", async () => {
    vi.mocked(api.prd.getProposedDiff).mockResolvedValue({
      requestId: "hil-abc123",
      fromContent: "# Same",
      toContent: "# Same",
      diff: {
        lines: [],
        summary: { additions: 0, deletions: 0 },
        pagination: { totalLines: 0, offset: 0, limit: 0, hasMore: false },
      },
    } as never);
    const notificationWithDiff = {
      ...mockNotification,
      scopeChangeMetadata: {
        scopeChangeSummary: "• feature_list: No change",
        scopeChangeProposedUpdates: [
          {
            section: "feature_list",
            changeLogEntry: "No change",
            content: "Same content",
          },
        ],
      },
    };
    renderWithProviders(
      <HilApprovalBlock
        notification={notificationWithDiff}
        projectId="proj-1"
        onResolved={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("diff-view")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("diff-view-no-changes")).toHaveTextContent("No changes");
    });
    expect(screen.getByTestId("hil-approve-btn")).toBeInTheDocument();
    expect(screen.getByTestId("hil-reject-btn")).toBeInTheDocument();
  });

  it("shows error and Dismiss when proposed-diff fails (e.g. 404)", async () => {
    vi.mocked(api.prd.getProposedDiff).mockRejectedValue(
      Object.assign(new Error("HIL approval request not found"), { code: "NOT_FOUND" })
    );
    const notificationWithDiff = {
      ...mockNotification,
      scopeChangeMetadata: {
        scopeChangeSummary: "• feature_list: Add mobile app",
        scopeChangeProposedUpdates: [
          {
            section: "feature_list",
            changeLogEntry: "Add mobile app",
            content: "1. Web dashboard\n2. Mobile app",
          },
        ],
      },
    };
    const user = userEvent.setup();
    renderWithProviders(
      <HilApprovalBlock
        notification={notificationWithDiff}
        projectId="proj-1"
        onResolved={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("hil-diff-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("hil-diff-error")).toHaveTextContent(
      "HIL approval request not found"
    );
    expect(screen.getByTestId("hil-diff-error-dismiss")).toBeInTheDocument();
    expect(screen.getByTestId("hil-approve-btn")).toBeInTheDocument();
    expect(screen.getByTestId("hil-reject-btn")).toBeInTheDocument();

    await user.click(screen.getByTestId("hil-diff-error-dismiss"));
    await waitFor(() => {
      expect(screen.queryByTestId("hil-diff-error")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("prd-diff-section-feature_list")).toBeInTheDocument();
    expect(screen.getByTestId("hil-approve-btn")).toBeInTheDocument();
  });

  it("hides PRD diff when hideDiffInBlock is true", async () => {
    const notificationWithDiff = {
      ...mockNotification,
      scopeChangeMetadata: {
        scopeChangeSummary: "• feature_list: Add mobile app",
        scopeChangeProposedUpdates: [
          {
            section: "feature_list",
            changeLogEntry: "Add mobile app",
            content: "1. Web dashboard\n2. Mobile app",
          },
        ],
      },
    };
    renderWithProviders(
      <HilApprovalBlock
        notification={notificationWithDiff}
        projectId="proj-1"
        onResolved={vi.fn()}
        hideDiffInBlock
      />
    );

    expect(screen.getByText("Approval required")).toBeInTheDocument();
    expect(screen.queryByText("Proposed PRD changes")).not.toBeInTheDocument();
    expect(screen.queryByTestId("prd-diff-section-feature_list")).not.toBeInTheDocument();
  });
});
