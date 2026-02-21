import { useState, useEffect } from "react";
import type { FeedbackItem, Plan } from "@opensprint/shared";
import { useAppDispatch } from "../../store";
import { api } from "../../api/client";
import { addNotification } from "../../store/slices/notificationSlice";

export function SourceFeedbackSection({
  projectId,
  feedbackId,
  plans: _plans,
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
    <div className="border-b border-theme-border">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-theme-border-subtle/50 transition-colors"
        aria-expanded={expanded}
        aria-controls="source-feedback-content"
        aria-label={expanded ? "Collapse Source Feedback" : "Expand Source Feedback"}
        id="source-feedback-header"
      >
        <h4 className="text-xs font-medium text-theme-muted uppercase tracking-wide">
          Source Feedback
        </h4>
        <span className="text-theme-muted text-xs">{expanded ? "▼" : "▶"}</span>
      </button>
      {expanded && (
        <div
          id="source-feedback-content"
          role="region"
          aria-labelledby="source-feedback-header"
          className="p-4 pt-0"
        >
          {loading ? (
            <div className="bg-theme-code-bg rounded-lg border border-theme-border overflow-hidden">
              <div className="p-4 text-xs text-theme-muted" data-testid="source-feedback-loading">
                Loading feedback…
              </div>
            </div>
          ) : feedback ? (
            <div
              className="bg-theme-code-bg rounded-lg border border-theme-border overflow-hidden p-4 text-xs space-y-2"
              data-testid="source-feedback-card"
            >
              {feedback.status === "resolved" && (
                <div className="flex items-start justify-between gap-2 overflow-hidden flex-wrap">
                  <span
                    className="inline-flex rounded-full px-2 py-0.5 font-medium flex-shrink-0 bg-theme-success-bg text-theme-success-text"
                    aria-label="Resolved"
                  >
                    Resolved
                  </span>
                </div>
              )}
              <p className="text-theme-text whitespace-pre-wrap break-words min-w-0">
                {feedback.text ?? "(No feedback text)"}
              </p>
              {feedback.createdAt && (
                <div className="text-theme-muted">
                  {new Date(feedback.createdAt).toLocaleString()}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
