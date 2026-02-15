import { useState, useEffect } from "react";
import { api, type ModelOption } from "../api/client";
import type { AgentType } from "@opensprint/shared";

interface ModelSelectProps {
  provider: AgentType;
  value: string | null;
  onChange: (modelId: string | null) => void;
  disabled?: boolean;
  className?: string;
  /** Increment to trigger a refetch of models (e.g. after saving an API key) */
  refreshTrigger?: number;
}

export function ModelSelect({
  provider,
  value,
  onChange,
  disabled,
  className = "input",
  refreshTrigger,
}: ModelSelectProps) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (provider !== "claude" && provider !== "cursor") {
      setModels([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    api.models
      .list(provider)
      .then((list) => setModels(list))
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load models");
        setModels([]);
      })
      .finally(() => setLoading(false));
  }, [provider, refreshTrigger]);

  if (provider === "custom") {
    return (
      <input
        type="text"
        className={className}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder="CLI command handles model"
        disabled={disabled}
      />
    );
  }

  if (loading) {
    return (
      <select className={className} disabled>
        <option>Loading models…</option>
      </select>
    );
  }

  if (error) {
    const hint =
      provider === "claude"
        ? "Check ANTHROPIC_API_KEY in .env"
        : provider === "cursor"
          ? "Check CURSOR_API_KEY in .env"
          : "";
    return (
      <div className="space-y-1">
        <select className={className} disabled>
          <option value="">No models ({hint})</option>
        </select>
        <p className="text-xs text-amber-600">{error}</p>
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <select className={className} disabled>
        <option value="">No models available</option>
      </select>
    );
  }

  const hasValue = value && value.length > 0;
  const valueInList = hasValue && models.some((m) => m.id === value);

  return (
    <select
      className={className}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
    >
      <option value="">Select model</option>
      {hasValue && !valueInList && <option value={value!}>{value}</option>}
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.displayName}
        </option>
      ))}
    </select>
  );
}
