import { CloseButton } from "../../../components/CloseButton";

export function DeletePlanConfirmModal({
  deletingPlanId,
  onCancel,
  onConfirm,
}: {
  deletingPlanId: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const busy = !!deletingPlanId;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 w-full h-full bg-theme-overlay backdrop-blur-sm border-0 cursor-default"
        onClick={() => !busy && onCancel()}
        aria-label="Close"
      />
      <div className="relative bg-theme-surface rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
          <h2 className="text-lg font-semibold text-theme-text">Delete plan</h2>
          <CloseButton onClick={() => !busy && onCancel()} ariaLabel="Close delete confirmation" />
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-theme-text">Are you sure?</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-theme-border bg-theme-bg rounded-b-xl">
          <button type="button" onClick={() => !busy && onCancel()} className="btn-secondary" disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="btn-primary disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Yes"}
          </button>
        </div>
      </div>
    </div>
  );
}
