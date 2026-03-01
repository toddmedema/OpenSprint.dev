/** Centered loading spinner for phase pages during initial fetch */
export function PhaseLoadingSpinner({
  "data-testid": dataTestId = "phase-loading-spinner",
  "aria-label": ariaLabel = "Loading",
}: {
  "data-testid"?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-10"
      data-testid={dataTestId}
      role="status"
      aria-label={ariaLabel}
    >
      <div
        className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin"
        aria-hidden
      />
      <span className="text-sm text-theme-muted">Loading...</span>
    </div>
  );
}
