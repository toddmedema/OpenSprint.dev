import { useState, useRef, useLayoutEffect } from "react";
import { CloseButton } from "../CloseButton";
import { useSubmitShortcut } from "../../hooks/useSubmitShortcut";
import { useModalA11y } from "../../hooks/useModalA11y";
import { loadTextDraft, planIdeaDraftStorageKey } from "../../lib/agentInputDraftStorage";
import { useOptimisticTextDraft } from "../../hooks/useOptimisticTextDraft";

export interface AddPlanModalProps {
  projectId: string;
  onGenerate: (description: string) => Promise<boolean>;
  onClose: () => void;
}

export function AddPlanModal({ projectId, onGenerate, onClose }: AddPlanModalProps) {
  const draftKey = planIdeaDraftStorageKey(projectId);
  const [featureDescription, setFeatureDescription] = useState(() => loadTextDraft(draftKey));
  const { beginSend, onSuccess } = useOptimisticTextDraft(
    draftKey,
    featureDescription,
    setFeatureDescription
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const featureInputRef = useRef<HTMLTextAreaElement>(null);
  useModalA11y({ containerRef, onClose, isOpen: true, initialFocusRef: featureInputRef });

  useLayoutEffect(() => {
    setFeatureDescription(loadTextDraft(draftKey));
  }, [draftKey]);

  const handleGenerate = () => {
    const description = featureDescription.trim();
    if (!description) return;
    beginSend(description);
    onSuccess();
    onClose();
    void onGenerate(description);
  };

  const onKeyDown = useSubmitShortcut(handleGenerate, {
    multiline: true,
    disabled: !featureDescription.trim(),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 w-full h-full bg-theme-overlay backdrop-blur-sm border-0 cursor-default"
        onClick={onClose}
        aria-label="Close"
      />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add Plan"
        className="relative bg-theme-surface rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col"
        data-testid="add-plan-modal"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
          <h2 className="text-lg font-semibold text-theme-text">Add Plan</h2>
          <CloseButton onClick={onClose} ariaLabel="Close Add Plan modal" />
        </div>
        <div className="px-5 py-4">
          <label
            htmlFor="add-plan-feature-description"
            className="block text-sm font-medium text-theme-text mb-2"
          >
            Feature plan idea
          </label>
          <textarea
            ref={featureInputRef}
            id="add-plan-feature-description"
            className="input w-full text-sm min-h-[100px] resize-y"
            value={featureDescription}
            onChange={(e) => setFeatureDescription(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Describe your feature idea…"
            data-testid="feature-description-input"
          />
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-theme-border bg-theme-bg rounded-b-xl">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleGenerate();
            }}
            disabled={!featureDescription.trim()}
            className="btn-primary text-sm disabled:opacity-50"
            data-testid="generate-plan-button"
          >
            Generate Plan
          </button>
        </div>
      </div>
    </div>
  );
}
