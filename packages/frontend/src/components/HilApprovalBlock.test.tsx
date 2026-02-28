import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HilApprovalBlock } from "./HilApprovalBlock";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    notifications: {
      resolve: vi.fn(),
    },
  },
}));

const mockNotification = {
  id: "hil-abc123",
  projectId: "proj-1",
  source: "eval" as const,
  sourceId: "fb-1",
  questions: [
    { id: "q1", text: "Approve this scope change?", createdAt: "2025-01-01T00:00:00Z" },
  ],
  status: "open" as const,
  createdAt: "2025-01-01T00:00:00Z",
  resolvedAt: null,
  kind: "hil_approval" as const,
};

describe("HilApprovalBlock", () => {
  beforeEach(() => {
    vi.mocked(api.notifications.resolve).mockResolvedValue({} as never);
  });

  it("renders approval required with Approve and Reject buttons", () => {
    const onResolved = vi.fn();
    render(
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
    render(
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
    render(
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
});
