import { useState, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentSession } from "@opensprint/shared";
import { filterAgentOutput } from "../../utils/agentOutputFilter";

export function ArchivedSessionView({ sessions }: { sessions: AgentSession[] }) {
  const [activeTab, setActiveTab] = useState<"output" | "diff">("output");
  const [selectedIdx, setSelectedIdx] = useState(sessions.length - 1);
  useEffect(() => {
    setSelectedIdx(Math.max(0, sessions.length - 1));
  }, [sessions]);
  const safeIdx = Math.min(selectedIdx, Math.max(0, sessions.length - 1));
  const session = sessions[safeIdx];
  if (!session) return null;

  const filteredOutput = useMemo(
    () => (session.outputLog ? filterAgentOutput(session.outputLog) : ""),
    [session.outputLog]
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-theme-border flex items-center gap-4 text-xs flex-wrap">
        {sessions.length > 1 ? (
          <select
            value={safeIdx}
            onChange={(e) => setSelectedIdx(Number(e.target.value))}
            className="bg-theme-bg-elevated text-theme-success-muted border border-theme-border rounded pl-2 pr-10 py-1"
          >
            {sessions.map((s, i) => (
              <option key={s.attempt} value={i}>
                Attempt {s.attempt} ({s.status})
              </option>
            ))}
          </select>
        ) : (
          <span className="text-theme-muted">
            Attempt {session.attempt} · {session.status} · {session.agentType}
          </span>
        )}
        {session.testResults && session.testResults.total > 0 && (
          <span className="text-theme-success-muted">
            {session.testResults.passed} passed
            {session.testResults.failed > 0 && `, ${session.testResults.failed} failed`}
          </span>
        )}
        {session.failureReason && (
          <span
            className="text-theme-warning-solid truncate max-w-[200px]"
            title={session.failureReason}
          >
            {session.failureReason}
          </span>
        )}
      </div>
      <div className="flex gap-2 px-4 py-2 border-b border-theme-border shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab("output")}
          className={`text-xs font-medium ${
            activeTab === "output"
              ? "text-theme-success-muted"
              : "text-theme-muted hover:text-theme-text"
          }`}
        >
          Output log
        </button>
        {session.gitDiff && (
          <button
            type="button"
            onClick={() => setActiveTab("diff")}
            className={`text-xs font-medium ${
              activeTab === "diff"
                ? "text-theme-success-muted"
                : "text-theme-muted hover:text-theme-text"
            }`}
          >
            Git diff
          </button>
        )}
      </div>
      {activeTab === "output" ? (
        <div className="flex-1 p-4 text-xs overflow-y-auto prose prose-sm prose-neutral dark:prose-invert prose-execute-task max-w-none prose-pre:bg-theme-code-bg prose-pre:text-theme-code-text prose-pre:border prose-pre:border-theme-border prose-pre:rounded-lg">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {filteredOutput || "(no output)"}
          </ReactMarkdown>
        </div>
      ) : (
        <pre className="flex-1 p-4 text-xs font-mono whitespace-pre-wrap overflow-y-auto">
          {session.gitDiff || "(no diff)"}
        </pre>
      )}
    </div>
  );
}
