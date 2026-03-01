import { useState, useCallback } from "react";
import type { Notification } from "@opensprint/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { queryKeys } from "../api/queryKeys";
import { PrdDiffView } from "./prd/PrdDiffView";

export interface HilApprovalBlockProps {
  /** HIL approval notification (kind: hil_approval) */
  notification: Notification;
  projectId: string;
  /** Called when notification is resolved (after Approve or Reject) */
  onResolved: () => void;
}

/**
 * Renders Approve/Reject buttons for HIL approval notifications.
 * When scopeChangeMetadata is present, shows a PRD diff for review before accepting/rejecting.
 * Surfaces in eval (scope change) and sketch (architecture) contexts.
 */
export function HilApprovalBlock({
  notification,
  projectId,
  onResolved,
}: HilApprovalBlockProps) {
  const [loading, setLoading] = useState(false);

  const { data: currentPrd } = useQuery({
    queryKey: queryKeys.prd.detail(projectId),
    queryFn: () => api.prd.get(projectId),
    enabled:
      !!notification.scopeChangeMetadata?.scopeChangeProposedUpdates?.length,
  });

  const handleApprove = useCallback(async () => {
    setLoading(true);
    try {
      await api.notifications.resolve(projectId, notification.id, {
        approved: true,
      });
      onResolved();
    } finally {
      setLoading(false);
    }
  }, [projectId, notification.id, onResolved]);

  const handleReject = useCallback(async () => {
    setLoading(true);
    try {
      await api.notifications.resolve(projectId, notification.id, {
        approved: false,
      });
      onResolved();
    } finally {
      setLoading(false);
    }
  }, [projectId, notification.id, onResolved]);

  const description = notification.questions?.[0]?.text ?? "Approval required";
  const hasPrdDiff =
    notification.scopeChangeMetadata?.scopeChangeProposedUpdates?.length > 0;

  return (
    <div
      className="p-4 border-b border-theme-border border-l-4 bg-theme-warning-bg/30 border-l-theme-warning-solid"
      data-question-id={notification.id}
      data-testid="hil-approval-block"
    >
      <h4 className="text-xs font-medium text-theme-muted uppercase tracking-wide mb-2">
        Approval required
      </h4>
      <p className="text-sm text-theme-text mb-3">{description}</p>
      {hasPrdDiff && notification.scopeChangeMetadata && (
        <div className="mb-4 rounded-lg border border-theme-border bg-theme-surface p-3">
          <h5 className="text-xs font-medium text-theme-muted uppercase tracking-wide mb-2">
            Proposed PRD changes
          </h5>
          <PrdDiffView
            currentPrd={currentPrd ?? null}
            scopeChangeMetadata={notification.scopeChangeMetadata}
          />
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleApprove}
          disabled={loading}
          className="btn-primary text-sm px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="hil-approve-btn"
        >
          {loading ? "Submitting…" : "Approve"}
        </button>
        <button
          type="button"
          onClick={handleReject}
          disabled={loading}
          className="text-sm px-3 py-2 rounded-lg border border-theme-border bg-theme-surface-muted text-theme-text hover:bg-theme-border-subtle disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="hil-reject-btn"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
