import { useState } from "react";
import { api } from "../api/client";
import type { Plan } from "@opensprint/shared";
import type { PlanComplexity } from "@opensprint/shared";

const COMPLEXITY_OPTIONS: { value: PlanComplexity; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "very_high", label: "Very High" },
];

function defaultPlanContent(title: string): string {
  return `# ${title}

## Overview

Brief description of the feature and its purpose.

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Technical Approach

Describe the technical implementation approach.

## Dependencies

References to other Plans this feature depends on (if any).

## Data Model Changes

Schema or data model updates required.

## API Specification

Endpoints and contracts for this feature.

## UI/UX Requirements

User interface and experience requirements.

## Mockups

\`\`\`
+------------------+
| Header           |
+------------------+
| Content area     |
|                  |
+------------------+
\`\`\`

## Edge Cases and Error Handling

How to handle errors and edge cases.

## Testing Strategy

How this feature will be tested.
`;
}

interface AddPlanModalProps {
  projectId: string;
  onClose: () => void;
  onCreated: (plan: Plan) => void;
}

export function AddPlanModal({ projectId, onClose, onCreated }: AddPlanModalProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [complexity, setComplexity] = useState<PlanComplexity>("medium");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (!value.trim()) {
      setContent("");
    } else if (!content.trim()) {
      setContent(defaultPlanContent(value));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const plan = await api.plans.create(projectId, {
        title: trimmedTitle,
        content: content.trim() || defaultPlanContent(trimmedTitle),
        complexity,
      });
      onCreated(plan as Plan);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create plan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <form
        onSubmit={handleSubmit}
        className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Add Plan</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Feature Title</label>
            <input
              type="text"
              className="input"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="e.g. User Authentication"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Complexity</label>
            <select
              className="input"
              value={complexity}
              onChange={(e) => setComplexity(e.target.value as PlanComplexity)}
            >
              {COMPLEXITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Plan Markdown</label>
            <textarea
              className="input font-mono text-sm min-h-[280px]"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Plan specification in markdown format"
            />
            <p className="mt-1 text-xs text-gray-400">
              Include overview, acceptance criteria, technical approach, and other sections per PRD §7.2.3
            </p>
          </div>
        </div>

        {error && (
          <div className="mx-5 mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving || !title.trim()} className="btn-primary disabled:opacity-50">
            {saving ? "Creating…" : "Create Plan"}
          </button>
        </div>
      </form>
    </div>
  );
}
