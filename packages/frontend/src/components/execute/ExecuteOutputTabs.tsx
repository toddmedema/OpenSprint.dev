import { useState, type ReactNode } from "react";

export type ExecuteOutputTab = "output" | "chat";

export interface ExecuteOutputTabsProps {
  outputContent: ReactNode;
  chatContent: ReactNode;
  /** Called when the active tab changes. */
  onTabChange?: (tab: ExecuteOutputTab) => void;
}

export function ExecuteOutputTabs({
  outputContent,
  chatContent,
  onTabChange,
}: ExecuteOutputTabsProps) {
  const [activeTab, setActiveTab] = useState<ExecuteOutputTab>("output");

  const handleTabChange = (tab: ExecuteOutputTab) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  return (
    <div className="flex flex-col min-h-[200px] max-h-[500px]" data-testid="execute-output-tabs">
      <div
        className="flex border-b border-theme-border shrink-0"
        role="tablist"
        aria-label="Agent output tabs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "output"}
          aria-controls="execute-output-tabpanel"
          id="execute-output-tab"
          onClick={() => handleTabChange("output")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "output"
              ? "text-brand-600 border-b-2 border-brand-600"
              : "text-theme-muted hover:text-theme-text"
          }`}
        >
          Output
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "chat"}
          aria-controls="execute-chat-tabpanel"
          id="execute-chat-tab"
          onClick={() => handleTabChange("chat")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "chat"
              ? "text-brand-600 border-b-2 border-brand-600"
              : "text-theme-muted hover:text-theme-text"
          }`}
        >
          Chat
        </button>
      </div>

      <div
        role="tabpanel"
        id={activeTab === "output" ? "execute-output-tabpanel" : "execute-chat-tabpanel"}
        aria-labelledby={activeTab === "output" ? "execute-output-tab" : "execute-chat-tab"}
        className="flex-1 min-h-0 overflow-hidden"
      >
        {activeTab === "output" ? outputContent : chatContent}
      </div>
    </div>
  );
}
