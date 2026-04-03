import React from "react";
import type { CommandRun, CommandStatus } from "@opensprint/shared";
import { useCommandHistory } from "../../api/hooks/commands";

const STATUS_STYLES: Record<CommandStatus, { label: string; className: string }> = {
  interpreting: { label: "Interpreting", className: "text-blue-400 bg-blue-500/10" },
  previewing: { label: "Previewing", className: "text-purple-400 bg-purple-500/10" },
  awaiting_confirmation: { label: "Awaiting", className: "text-yellow-400 bg-yellow-500/10" },
  executing: { label: "Executing", className: "text-blue-400 bg-blue-500/10" },
  completed: { label: "Completed", className: "text-green-400 bg-green-500/10" },
  failed: { label: "Failed", className: "text-red-400 bg-red-500/10" },
  cancelled: { label: "Cancelled", className: "text-gray-400 bg-gray-500/10" },
};

function CommandRunCard({
  run,
  onRerun,
}: {
  run: CommandRun;
  onRerun?: (input: string) => void;
}) {
  const statusStyle = STATUS_STYLES[run.status] ?? STATUS_STYLES.failed;
  const commandType = run.interpreted_command?.commandType?.replace(/_/g, " ") ?? "—";

  return (
    <div
      className="px-4 py-3 border-b border-theme-border hover:bg-theme-surface-hover/50 transition-colors"
      data-testid={`command-run-${run.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-theme-text truncate">{run.raw_input}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-theme-text-secondary font-mono">{commandType}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusStyle.className}`}>
              {statusStyle.label}
            </span>
            <span className="text-[10px] text-theme-text-secondary">
              {new Date(run.created_at).toLocaleString()}
            </span>
          </div>
          {run.result?.summary && (
            <p className="text-xs text-theme-text-secondary mt-1">{run.result.summary}</p>
          )}
        </div>
        {onRerun && run.status === "completed" && (
          <button
            onClick={() => onRerun(run.raw_input)}
            className="px-2 py-1 bg-theme-surface-hover hover:bg-theme-border text-theme-text-secondary text-[10px] rounded transition-colors whitespace-nowrap"
          >
            Rerun
          </button>
        )}
      </div>
    </div>
  );
}

interface CommandHistoryProps {
  projectId: string;
  onRerun?: (input: string) => void;
}

export function CommandHistory({ projectId, onRerun }: CommandHistoryProps) {
  const { data, isLoading, error } = useCommandHistory(projectId);

  return (
    <div className="flex flex-col h-full" data-testid="command-history">
      <div className="px-4 py-2 border-b border-theme-border bg-theme-surface">
        <h3 className="text-sm font-medium text-theme-text">Command History</h3>
        {data && (
          <p className="text-[10px] text-theme-text-secondary">{data.total} commands</p>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-4 text-sm text-theme-text-secondary">Loading command history...</div>
        )}
        {error && (
          <div className="p-4 text-sm text-red-400">Failed to load command history</div>
        )}
        {!isLoading && data?.runs.length === 0 && (
          <div className="p-4 text-sm text-theme-text-secondary">
            No commands yet. Press ⌘K to open the command bar.
          </div>
        )}
        {data?.runs.map((run) => (
          <CommandRunCard key={run.id} run={run} onRerun={onRerun} />
        ))}
      </div>
    </div>
  );
}
