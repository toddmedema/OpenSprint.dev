import { useState } from "react";
import { AGENT_ROLE_LABELS } from "@opensprint/shared";
import { VirtualizedAgentOutput } from "../../../components/execute/VirtualizedAgentOutput";
import { CollapsibleSection } from "../../../components/execute/CollapsibleSection";
import { formatUptime } from "../../../lib/formatting";
import { useAutoScroll } from "../../../hooks/useAutoScroll";

export function PlanAuditorOutputSection({
  planId,
  auditorOutput,
  wsConnected,
  activeAuditor,
  onRetryConnect,
}: {
  planId: string;
  auditorOutput: string;
  wsConnected: boolean;
  activeAuditor?: { startedAt: string; label?: string };
  onRetryConnect: () => void;
}) {
  const [auditorExpanded, setAuditorExpanded] = useState(true);
  const {
    containerRef: liveOutputRef,
    showJumpToBottom,
    jumpToBottom,
    handleScroll: handleLiveOutputScroll,
  } = useAutoScroll({
    contentLength: auditorOutput.length,
    resetKey: planId,
  });

  const liveOutputContent =
    auditorOutput.length > 0 ? auditorOutput : !wsConnected ? "" : "Waiting for Auditor output...";

  return (
    <div className="border-b border-theme-border">
      <CollapsibleSection
        title="Auditor"
        expanded={auditorExpanded}
        onToggle={() => setAuditorExpanded((p) => !p)}
        expandAriaLabel="Expand Auditor output"
        collapseAriaLabel="Collapse Auditor output"
        contentId="auditor-output-content"
        headerId="auditor-output-header"
      >
        <div className="bg-theme-code-bg rounded-lg border border-theme-border overflow-hidden min-h-[160px] max-h-[320px] flex flex-col">
          {activeAuditor && (
            <div
              className="px-3 py-1.5 rounded-t-lg bg-theme-warning-bg border-b border-theme-warning-border text-xs font-medium text-theme-warning-text flex items-center gap-3 min-w-0"
              data-testid="plan-auditor-active-callout"
            >
              <span className="truncate">
                {AGENT_ROLE_LABELS.auditor ?? "Auditor"}
                {activeAuditor.label && ` · ${activeAuditor.label}`}
                {activeAuditor.startedAt && <> · {formatUptime(activeAuditor.startedAt)}</>}
              </span>
            </div>
          )}
          {!wsConnected ? (
            <div className="p-4 flex flex-col gap-3" data-testid="plan-auditor-connecting">
              <div className="text-sm text-theme-muted flex items-center gap-2">
                <span
                  className="inline-block w-4 h-4 border-2 border-theme-border border-t-brand-500 rounded-full animate-spin"
                  aria-hidden
                />
                Connecting to live output…
              </div>
              <button
                type="button"
                onClick={onRetryConnect}
                className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline self-start"
                data-testid="plan-auditor-retry-connect"
              >
                Retry connection
              </button>
            </div>
          ) : (
            <div className="relative flex flex-col min-h-0 flex-1">
              <VirtualizedAgentOutput
                content={liveOutputContent}
                mode="stream"
                containerRef={liveOutputRef}
                onScroll={handleLiveOutputScroll}
                data-testid="plan-auditor-output"
              />
              {showJumpToBottom && (
                <button
                  type="button"
                  onClick={jumpToBottom}
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 text-xs font-medium rounded-full bg-theme-surface border border-theme-border text-theme-text shadow-md hover:bg-theme-border-subtle/50 transition-colors z-10"
                  data-testid="plan-auditor-jump-to-bottom"
                  aria-label="Jump to bottom"
                >
                  Jump to bottom
                </button>
              )}
            </div>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}
