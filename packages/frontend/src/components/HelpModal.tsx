import { CloseButton } from "./CloseButton";
import { HelpContent } from "./HelpContent";

export interface HelpModalProps {
  onClose: () => void;
  /** Optional project context (per-project view vs homepage) */
  project?: { id: string; name: string } | null;
}

/**
 * Help modal with two tabs: Ask a Question (default) and Meet your Team.
 * Kept for backward compatibility; prefer HelpPage for full-screen experience.
 */
export function HelpModal({ onClose, project }: HelpModalProps) {
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-theme-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
      aria-label="Help"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      data-testid="help-modal-backdrop"
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col rounded-lg bg-theme-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="help-modal-content"
      >
        <div className="shrink-0 border-b border-theme-border px-6 py-4 flex items-center justify-between">
          <h2 id="help-modal-title" className="text-lg font-semibold text-theme-text">
            Help
          </h2>
          <CloseButton onClick={onClose} ariaLabel="Close help" />
        </div>
        <div className="flex-1 min-h-0 overflow-hidden px-6 py-4">
          <HelpContent project={project} />
        </div>
      </div>
    </div>
  );
}
