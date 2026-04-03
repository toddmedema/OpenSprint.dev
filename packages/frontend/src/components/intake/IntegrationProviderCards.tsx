import React from "react";
import type { IntegrationProvider, IntegrationConnectionStatus } from "@opensprint/shared";

interface ProviderCardConfig {
  provider: IntegrationProvider;
  name: string;
  description: string;
  icon: string;
}

const PROVIDERS: ProviderCardConfig[] = [
  {
    provider: "todoist",
    name: "Todoist",
    description: "Import tasks from a Todoist project as feedback items.",
    icon: "✓",
  },
  {
    provider: "github",
    name: "GitHub Issues",
    description: "Ingest issues from a GitHub repository.",
    icon: "⚙",
  },
  {
    provider: "slack",
    name: "Slack",
    description: "Import messages from a Slack channel.",
    icon: "#",
  },
  {
    provider: "webhook",
    name: "Webhook",
    description: "Receive items via an inbound webhook endpoint.",
    icon: "→",
  },
];

const STATUS_STYLES: Record<IntegrationConnectionStatus | "disconnected", { label: string; className: string }> = {
  active: { label: "Connected", className: "text-green-400 bg-green-500/10" },
  needs_reconnect: { label: "Needs Reconnect", className: "text-orange-400 bg-orange-500/10" },
  disabled: { label: "Paused", className: "text-gray-400 bg-gray-500/10" },
  disconnected: { label: "Not Connected", className: "text-theme-text-secondary bg-theme-surface-hover" },
};

interface ConnectionInfo {
  status: IntegrationConnectionStatus;
  lastSyncAt?: string;
  lastError?: string;
  sourceName?: string;
}

interface IntegrationProviderCardsProps {
  /** When set, only these providers are rendered (order follows the built-in list). */
  providerFilter?: readonly IntegrationProvider[];
  /** When false, cards are rendered without an outer grid (for composing into a parent grid). */
  asGrid?: boolean;
  connections: Record<string, ConnectionInfo | undefined>;
  onConnect: (provider: IntegrationProvider) => void;
  onDisconnect: (provider: IntegrationProvider) => void;
  onSync: (provider: IntegrationProvider) => void;
  onConfigure: (provider: IntegrationProvider) => void;
}

export function IntegrationProviderCards({
  providerFilter,
  asGrid = true,
  connections,
  onConnect,
  onDisconnect,
  onSync,
  onConfigure,
}: IntegrationProviderCardsProps) {
  const list = providerFilter?.length
    ? PROVIDERS.filter((p) => providerFilter.includes(p.provider))
    : PROVIDERS;

  const cards = list.map((p) => {
        const conn = connections[p.provider];
        const statusKey = conn?.status ?? "disconnected";
        const statusStyle = STATUS_STYLES[statusKey];
        const isConnected = conn && conn.status !== "disabled";

        return (
          <div
            key={p.provider}
            className="rounded-lg border border-theme-border bg-theme-surface p-4 flex flex-col gap-3"
            data-testid={`provider-card-${p.provider}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg w-7 h-7 flex items-center justify-center rounded bg-theme-surface-hover font-mono">
                  {p.icon}
                </span>
                <div>
                  <p className="text-sm font-medium text-theme-text">{p.name}</p>
                  <p className="text-xs text-theme-text-secondary">{p.description}</p>
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${statusStyle.className}`}>
                {statusStyle.label}
              </span>
            </div>

            {conn?.sourceName && (
              <p className="text-xs text-theme-text-secondary">
                Source: <span className="text-theme-text">{conn.sourceName}</span>
              </p>
            )}

            {conn?.lastSyncAt && (
              <p className="text-[10px] text-theme-text-secondary">
                Last sync: {new Date(conn.lastSyncAt).toLocaleString()}
              </p>
            )}

            {conn?.lastError && (
              <p className="text-[10px] text-red-400 truncate" title={conn.lastError}>
                Error: {conn.lastError}
              </p>
            )}

            <div className="flex items-center gap-2 mt-auto pt-2 border-t border-theme-border">
              {!conn ? (
                <button
                  onClick={() => onConnect(p.provider)}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded transition-colors"
                >
                  Connect
                </button>
              ) : (
                <>
                  <button
                    onClick={() => onConfigure(p.provider)}
                    className="px-2 py-1 bg-theme-surface-hover hover:bg-theme-border text-theme-text text-xs rounded transition-colors"
                  >
                    Configure
                  </button>
                  {isConnected && (
                    <button
                      onClick={() => onSync(p.provider)}
                      className="px-2 py-1 bg-theme-surface-hover hover:bg-theme-border text-theme-text text-xs rounded transition-colors"
                    >
                      Sync Now
                    </button>
                  )}
                  <button
                    onClick={() => onDisconnect(p.provider)}
                    className="px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs rounded transition-colors ml-auto"
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>
          </div>
        );
      });

  if (!asGrid) {
    return <>{cards}</>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="integration-provider-cards">
      {cards}
    </div>
  );
}
