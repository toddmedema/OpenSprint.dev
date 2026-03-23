import { useCallback } from "react";
import type { NotificationVariant } from "./notificationStyles";

interface DismissButtonProps {
  onDismiss: () => void;
  variant?: NotificationVariant;
  label?: string;
}

const VARIANT_CLASSES: Record<NotificationVariant, string> = {
  bold: "hover:bg-white/20 focus-visible:ring-white focus-visible:ring-offset-transparent",
  muted:
    "text-theme-muted hover:bg-theme-border-subtle hover:text-theme-text focus-visible:ring-theme-accent",
};

export function DismissButton({
  onDismiss,
  variant = "bold",
  label = "Dismiss",
}: DismissButtonProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " ") {
        e.preventDefault();
        onDismiss();
      }
    },
    [onDismiss]
  );

  return (
    <button
      type="button"
      onClick={onDismiss}
      onKeyDown={handleKeyDown}
      className={`shrink-0 p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${VARIANT_CLASSES[variant]}`}
      aria-label={label}
    >
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}
