import { useState, useEffect } from "react";
import type { FeedbackItem, Plan } from "@opensprint/shared";
import { useAppDispatch } from "../../store";
import { api } from "../../api/client";
import { addNotification } from "../../store/slices/notificationSlice";
import { getEpicTitleFromPlan } from "../../lib/planContentUtils";
import { CollapsibleSection } from "./CollapsibleSection";

export function SourceFeedbackSection({
  projectId,
  feedbackId,
  plans,
  expanded,
  onToggle,
}: {
  projectId: string;
  feedbackId: string;
  plans: Plan[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const dispatch = useAppDispatch();
  const [feedback, setFeedback] = useState<FeedbackItem | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    setLoading(true);
    api.feedback
      .get(projectId, feedbackId)
      .then(setFeedback)
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Failed to load feedback";
        dispatch(addNotification({ message: msg, severity: "error" }));
      })
      .finally(() => setLoading(false));
  }, [projectId, feedbackId, expanded, dispatch]);

  return (
    <CollapsibleSection
      title="Source Feedback"
      expanded={expanded}
      onToggle={onToggle}
      expandAriaLabel="Expand Source Feedback"
      collapseAriaLabel="Collapse Source Feedback"
      contentId="source-feedback-content"
      headerId="source-feedback-header"
    >
      {loading ? (
            <div className="bg-theme-code-bg rounded-lg border border-theme-border overflow-hidden">
              <div className="p-4 text-xs text-theme-muted" data-testid="source-feedback-loading">
                Loading feedback…
              </div>
            </div>
          ) : feedback ? (
            <div
              className="bg-theme-code-bg rounded-lg border border-theme-border overflow-hidden"
              data-testid="source-feedback-card"
            >
              <div className="p-4 text-xs space-y-2">
                <div className="flex items-start justify-between gap-2 overflow-hidden flex-wrap">
                  {feedback.status === "resolved" && (
                    <span
                      className="inline-flex rounded-full px-2 py-0.5 font-medium flex-shrink-0 bg-theme-success-bg text-theme-success-text"
                      aria-label="Resolved"
                    >
                      Resolved
                    </span>
                  )}
                  {feedback.category && (
                    <span
                      className="inline-flex rounded-full px-2 py-0.5 font-medium flex-shrink-0 bg-theme-surface-muted text-theme-text capitalize"
                      aria-label={`Category: ${feedback.category}`}
                    >
                      {feedback.category === "ux"
                        ? "UX"
                        : feedback.category.charAt(0).toUpperCase() + feedback.category.slice(1)}
                    </span>
                  )}
                </div>
                <p className="text-theme-text whitespace-pre-wrap break-words min-w-0">
                  {feedback.text ?? "(No feedback text)"}
                </p>
                {feedback.mappedPlanId && plans.length > 0 && (
                  <div className="text-theme-muted">
                    Mapped plan:{" "}
                    {getEpicTitleFromPlan(
                      plans.find((p) => p.metadata.planId === feedback.mappedPlanId) ?? {
                        content: "",
                        metadata: { planId: feedback.mappedPlanId },
                      }
                    )}
                  </div>
                )}
                {feedback.createdAt && (
                  <div className="text-theme-muted">
                    {new Date(feedback.createdAt).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          ) : null}
    </CollapsibleSection>
  );
}
