import { useRef } from "react";
import { CloseButton } from "./CloseButton";
import { GlobalSettingsContent } from "./GlobalSettingsContent";
import { useModalA11y } from "../hooks/useModalA11y";

interface DisplaySettingsModalProps {
  onClose: () => void;
}

/**
 * Global display settings modal (homepage or when no project selected).
 * Shows theme and running agents display mode — stored in localStorage (opensprint.theme,
 * opensprint.runningAgentsDisplayMode) per PRD UserPreferences.
 */
export function DisplaySettingsModal({ onClose }: DisplaySettingsModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useModalA11y({ containerRef, onClose, isOpen: true });

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
        aria-labelledby="display-settings-modal-title"
        className="relative bg-theme-surface rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col"
        data-testid="display-settings-modal"
      >
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-theme-border">
          <h2 id="display-settings-modal-title" className="text-lg font-semibold text-theme-text">
            Settings
          </h2>
          <CloseButton onClick={onClose} ariaLabel="Close settings modal" />
        </div>
        <div className="px-5 py-4 pt-[15px]">
          <GlobalSettingsContent />
        </div>
      </div>
    </div>
  );
}
