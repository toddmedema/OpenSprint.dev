export function PlanPhaseErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="mb-4 flex items-center justify-between gap-3 p-3 bg-theme-error-bg border border-theme-error-border rounded-lg"
      data-testid="plan-error-banner"
    >
      <span className="flex-1 min-w-0 text-sm text-theme-error-text">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 p-1.5 rounded hover:bg-theme-error-border/50 text-theme-error-text hover:opacity-80 transition-colors"
        aria-label="Dismiss error"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
