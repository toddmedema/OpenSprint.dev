import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import type { IntakeItem, IntakeTriageStatus } from "@opensprint/shared";
import { useConvertIntakeItem, useIgnoreIntakeItem } from "../../api/hooks/intake";

const PROVIDER_LABELS: Record<string, string> = {
  todoist: "Todoist",
  github: "GitHub",
  slack: "Slack",
  webhook: "Webhook",
};

const STATUS_LABELS: Record<IntakeTriageStatus, string> = {
  new: "New",
  triaged: "Triaged",
  converted: "Converted",
  ignored: "Ignored",
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400",
  high: "bg-orange-500/20 text-orange-400",
  medium: "bg-yellow-500/20 text-yellow-400",
  low: "bg-blue-500/20 text-blue-400",
};

export interface IntakeInboxProps {
  projectId: string;
  items: IntakeItem[];
  isLoading: boolean;
  isError: boolean;
}

function ProviderBadge({ provider }: { provider: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-theme-border text-theme-text-secondary">
      {PROVIDER_LABELS[provider] ?? provider}
    </span>
  );
}

function StatusBadge({ status }: { status: IntakeTriageStatus }) {
  const colors: Record<IntakeTriageStatus, string> = {
    new: "bg-blue-500/20 text-blue-400",
    triaged: "bg-purple-500/20 text-purple-400",
    converted: "bg-green-500/20 text-green-400",
    ignored: "bg-gray-500/20 text-gray-400",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${colors[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function IntakeItemCard({
  item,
  isSelected,
  onSelect,
}: {
  item: IntakeItem;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 border-b border-theme-border transition-colors ${
        isSelected ? "bg-theme-surface-hover" : "hover:bg-theme-surface-hover/50"
      }`}
      data-testid={`intake-item-${item.id}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-theme-text truncate">{item.title}</p>
          {item.body && (
            <p className="text-xs text-theme-text-secondary mt-0.5 line-clamp-2">{item.body}</p>
          )}
          <div className="flex items-center gap-1.5 mt-1.5">
            <ProviderBadge provider={item.provider} />
            <StatusBadge status={item.triage_status} />
            {item.triage_suggestion?.priority && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${PRIORITY_COLORS[item.triage_suggestion.priority] ?? ""}`}>
                {item.triage_suggestion.priority}
              </span>
            )}
            {item.author && (
              <span className="text-[10px] text-theme-text-secondary">{item.author}</span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function IntakeDetailPanel({
  item,
  projectId,
}: {
  item: IntakeItem;
  projectId: string;
}) {
  const convertMutation = useConvertIntakeItem(projectId);
  const ignoreMutation = useIgnoreIntakeItem(projectId);

  const suggestion = item.triage_suggestion;

  return (
    <div className="p-4 space-y-4" data-testid="intake-detail-panel">
      <div>
        <h3 className="text-base font-semibold text-theme-text">{item.title}</h3>
        <div className="flex items-center gap-2 mt-1">
          <ProviderBadge provider={item.provider} />
          <StatusBadge status={item.triage_status} />
          {item.author && <span className="text-xs text-theme-text-secondary">by {item.author}</span>}
        </div>
      </div>

      {item.body && (
        <div className="text-sm text-theme-text-secondary whitespace-pre-wrap bg-theme-surface-hover rounded p-3">
          {item.body}
        </div>
      )}

      {item.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.labels.map((label) => (
            <span key={label} className="px-2 py-0.5 bg-theme-border rounded text-xs text-theme-text-secondary">
              {label}
            </span>
          ))}
        </div>
      )}

      {suggestion && (
        <div className="bg-theme-surface-hover rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-theme-text-secondary uppercase tracking-wide">AI Recommendation</p>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[suggestion.priority] ?? ""}`}>
              {suggestion.priority} priority
            </span>
            <span className="text-xs text-theme-text-secondary">
              {Math.round(suggestion.confidence * 100)}% confidence
            </span>
          </div>
          {suggestion.reasoning && (
            <p className="text-xs text-theme-text-secondary">{suggestion.reasoning}</p>
          )}
          {suggestion.duplicateOf && (
            <p className="text-xs text-orange-400">Possible duplicate of: {suggestion.duplicateOf}</p>
          )}
        </div>
      )}

      {item.triage_status !== "converted" && item.triage_status !== "ignored" && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-theme-border">
          <button
            onClick={() => convertMutation.mutate({ itemId: item.id, action: "to_feedback" })}
            disabled={convertMutation.isPending}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
          >
            Convert to Feedback
          </button>
          <button
            onClick={() => convertMutation.mutate({ itemId: item.id, action: "to_task_draft" })}
            disabled={convertMutation.isPending}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
          >
            Create Task Draft
          </button>
          <button
            onClick={() => ignoreMutation.mutate(item.id)}
            disabled={ignoreMutation.isPending}
            className="px-3 py-1.5 bg-theme-border hover:bg-theme-surface-hover text-theme-text-secondary text-xs font-medium rounded transition-colors disabled:opacity-50"
          >
            Ignore
          </button>
        </div>
      )}

      <div className="text-[10px] text-theme-text-secondary pt-2 border-t border-theme-border space-y-0.5">
        <p>Source: {item.source_ref ?? "—"}</p>
        <p>External ID: {item.external_item_id}</p>
        <p>Ingested: {new Date(item.created_at).toLocaleString()}</p>
      </div>
    </div>
  );
}

export function IntakeInbox({ projectId, items, isLoading, isError }: IntakeInboxProps) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedItemId && !items.some((i) => i.id === selectedItemId)) {
      setSelectedItemId(null);
    }
  }, [items, selectedItemId]);

  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null;

  return (
    <div className="flex flex-col h-full" data-testid="intake-inbox">
      <div className="flex flex-1 min-h-0">
        <div className="w-1/2 border-r border-theme-border overflow-y-auto">
          {isLoading && (
            <div className="p-4 text-sm text-theme-text-secondary">Loading intake items...</div>
          )}
          {isError && (
            <div className="p-4 text-sm text-red-400">Failed to load intake items</div>
          )}
          {!isLoading && items.length === 0 && (
            <div className="p-4 text-sm text-theme-text-secondary">
              <p>Connect an integration to start importing.</p>
              <div className="mt-3">
                <Link
                  to={`/projects/${projectId}/settings?tab=integrations`}
                  className="text-brand-600 hover:text-brand-700 font-medium underline"
                  data-testid="intake-open-integration-settings"
                >
                  Open Settings → Integrations
                </Link>
              </div>
            </div>
          )}
          {items.map((item) => (
            <IntakeItemCard
              key={item.id}
              item={item}
              isSelected={item.id === selectedItemId}
              onSelect={() => setSelectedItemId(item.id)}
            />
          ))}
        </div>

        <div className="w-1/2 overflow-y-auto">
          {selectedItem ? (
            <IntakeDetailPanel item={selectedItem} projectId={projectId} />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-theme-text-secondary">
              Select an item to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
