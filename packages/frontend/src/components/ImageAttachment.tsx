import { useRef } from "react";
import type { UseImageAttachmentReturn } from "../hooks/useImageAttachment";
import { MAX_IMAGES } from "../hooks/useImageAttachment";

export interface ImageAttachmentThumbnailsProps {
  attachment: UseImageAttachmentReturn;
  /** Optional wrapper className (e.g. "mb-3" for main form) */
  className?: string;
}

export interface ImageAttachmentButtonProps {
  attachment: UseImageAttachmentReturn;
  disabled?: boolean;
  /** "icon" = square icon-only (main form), "text" = "Attach image(s)" (reply form) */
  variant?: "icon" | "text";
  "data-testid"?: string;
}

/** Image icon for attach button */
function ImageIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

/** Thumbnail previews with remove buttons. Render above the action buttons. */
export function ImageAttachmentThumbnails({
  attachment,
  className = "",
}: ImageAttachmentThumbnailsProps) {
  const { images, removeImage } = attachment;
  if (images.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`.trim()}>
      {images.map((dataUrl, i) => (
        <div key={i} className="relative group">
          <img
            src={dataUrl}
            alt={`Attachment ${i + 1}`}
            className="h-16 w-16 object-cover rounded border border-theme-border"
          />
          <button
            type="button"
            onClick={() => removeImage(i)}
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-theme-error-solid text-white text-xs flex items-center justify-center hover:bg-theme-error-solid-hover transition-colors shadow"
            aria-label="Remove image"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** File input + attach button. Place in the action buttons row. */
export function ImageAttachmentButton({
  attachment,
  disabled = false,
  variant = "icon",
  "data-testid": dataTestId,
}: ImageAttachmentButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { images, handleFileInputChange } = attachment;
  const atLimit = images.length >= MAX_IMAGES;

  const buttonLabel = variant === "text" ? "Attach image(s)" : "Attach image";

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        data-testid={dataTestId ? `${dataTestId}-input` : undefined}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || atLimit}
        className={
          variant === "icon"
            ? "btn-secondary h-10 w-10 shrink-0 p-0 flex items-center justify-center disabled:opacity-50"
            : "btn-secondary h-10 shrink-0 px-3 flex items-center justify-center gap-1.5 disabled:opacity-50 text-sm"
        }
        title={buttonLabel}
        aria-label={buttonLabel}
        data-testid={dataTestId}
      >
        <ImageIcon className={variant === "icon" ? "w-5 h-5" : "w-4 h-4"} />
        {variant === "text" && <span>{buttonLabel}</span>}
      </button>
    </>
  );
}
