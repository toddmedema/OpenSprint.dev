/** Single-line boot-style status: circular spinner on the left, text on the right (matches desktop boot row). */
export function PhaseLoadingSpinner({
  "data-testid": dataTestId = "phase-loading-spinner",
  "aria-label": ariaLabel = "Loading",
  status = "Loading…",
}: {
  "data-testid"?: string;
  "aria-label"?: string;
  status?: string;
}) {
  return (
    <div
      className="inline-flex max-w-[min(100%,28rem)] flex-row items-center gap-3"
      data-testid={dataTestId}
      role="status"
      aria-label={ariaLabel}
    >
      <div
        className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-theme-border border-t-brand-600"
        aria-hidden
      />
      {status ? (
        <p
          className="text-left text-sm leading-snug text-theme-muted"
          data-testid={`${dataTestId}-status`}
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
