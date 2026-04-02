import { useState, useRef, useLayoutEffect, useEffect, useCallback, useId } from "react";
import type { PlanAttachment } from "@opensprint/shared";
import {
  PLAN_ATTACHMENT_ACCEPT,
  PLAN_ATTACHMENT_MAX_SIZE,
  PLAN_ATTACHMENT_MAX_COUNT,
} from "@opensprint/shared";
import { CloseButton } from "../CloseButton";
import { useSubmitShortcut } from "../../hooks/useSubmitShortcut";
import { useModalA11y } from "../../hooks/useModalA11y";
import { loadTextDraft, planIdeaDraftStorageKey } from "../../lib/agentInputDraftStorage";
import { useOptimisticTextDraft } from "../../hooks/useOptimisticTextDraft";

export interface AddPlanModalProps {
  projectId: string;
  onGenerate: (description: string, attachments?: PlanAttachment[]) => Promise<boolean>;
  onClose: () => void;
}

const ATTACH_CONTROL_LABEL = "Attach images or documents for more context";

const HOVER_TOOLTIP_DELAY_MS = 300;

const ACCEPTED_MIME_TYPES = Object.keys(PLAN_ATTACHMENT_ACCEPT);
const ACCEPT_STRING = Object.entries(PLAN_ATTACHMENT_ACCEPT)
  .flatMap(([mime, exts]) => [mime, ...exts])
  .join(",");

function getFileExtension(fileName: string): string {
  return fileName.lastIndexOf(".") >= 0
    ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase()
    : "";
}

function isAcceptedFile(file: File): boolean {
  if (ACCEPTED_MIME_TYPES.includes(file.type)) return true;
  return Object.values(PLAN_ATTACHMENT_ACCEPT).flat().includes(getFileExtension(file.name));
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsAttachment(file: File): Promise<PlanAttachment> {
  return new Promise((resolve, reject) => {
    const extension = getFileExtension(file.name);
    const isText = file.type === "text/markdown" || extension === ".md";
    const reader = new FileReader();
    reader.onload = () => {
      if (isText) {
        resolve({
          name: file.name,
          mimeType: file.type || "text/markdown",
          textContent: reader.result as string,
          size: file.size,
        });
      } else {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1] ?? "";
        const mimeType =
          file.type || (extension === ".pdf" ? "application/pdf" : "application/octet-stream");
        resolve({ name: file.name, mimeType, base64, size: file.size });
      }
    };
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    if (isText) reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

export function AddPlanModal({ projectId, onGenerate, onClose }: AddPlanModalProps) {
  const draftKey = planIdeaDraftStorageKey(projectId);
  const [featureDescription, setFeatureDescription] = useState(() => loadTextDraft(draftKey));
  const { beginSend, onSuccess, onFailure } = useOptimisticTextDraft(
    draftKey,
    featureDescription,
    setFeatureDescription
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const featureInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const attachTooltipHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const attachTooltipId = useId();
  const [attachTooltipVisible, setAttachTooltipVisible] = useState(false);
  useModalA11y({ containerRef, onClose, isOpen: true, initialFocusRef: featureInputRef });

  const [attachments, setAttachments] = useState<PlanAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const clearAttachTooltipHoverTimer = useCallback(() => {
    if (attachTooltipHoverTimerRef.current) {
      clearTimeout(attachTooltipHoverTimerRef.current);
      attachTooltipHoverTimerRef.current = null;
    }
  }, []);

  const hideAttachTooltip = useCallback(() => {
    clearAttachTooltipHoverTimer();
    setAttachTooltipVisible(false);
  }, [clearAttachTooltipHoverTimer]);

  useEffect(() => {
    return () => clearAttachTooltipHoverTimer();
  }, [clearAttachTooltipHoverTimer]);

  const handleAttachTooltipMouseEnter = useCallback(() => {
    attachTooltipHoverTimerRef.current = setTimeout(
      () => setAttachTooltipVisible(true),
      HOVER_TOOLTIP_DELAY_MS
    );
  }, []);

  const handleAttachTooltipMouseLeave = useCallback(() => {
    clearAttachTooltipHoverTimer();
    if (attachButtonRef.current !== document.activeElement) {
      setAttachTooltipVisible(false);
    }
  }, [clearAttachTooltipHoverTimer]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    setFeatureDescription(loadTextDraft(draftKey));
  }, [draftKey]);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      setAttachError(null);
      const incoming = Array.from(files);
      const errors: string[] = [];

      const validFiles: File[] = [];
      for (const f of incoming) {
        if (!isAcceptedFile(f)) {
          errors.push(`${f.name}: unsupported file type`);
        } else if (f.size > PLAN_ATTACHMENT_MAX_SIZE) {
          errors.push(`${f.name}: exceeds ${formatFileSize(PLAN_ATTACHMENT_MAX_SIZE)} limit`);
        } else {
          validFiles.push(f);
        }
      }

      setAttachments((prev) => {
        const remaining = PLAN_ATTACHMENT_MAX_COUNT - prev.length;
        if (validFiles.length > remaining) {
          errors.push(
            `Only ${PLAN_ATTACHMENT_MAX_COUNT} files allowed — ${validFiles.length - remaining} skipped`
          );
        }
        return prev; // updated below after async reads
      });

      const toProcess = validFiles.slice(
        0,
        Math.max(0, PLAN_ATTACHMENT_MAX_COUNT - attachments.length)
      );
      if (errors.length > 0) setAttachError(errors.join("; "));

      const read: PlanAttachment[] = [];
      for (const f of toProcess) {
        try {
          read.push(await readFileAsAttachment(f));
        } catch {
          setAttachError((prev) => [prev, `Failed to read ${f.name}`].filter(Boolean).join("; "));
        }
      }

      if (read.length > 0) {
        setAttachments((prev) => {
          const combined = [...prev, ...read];
          return combined.slice(0, PLAN_ATTACHMENT_MAX_COUNT);
        });
      }
    },
    [attachments.length]
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setAttachError(null);
  }, []);

  const handleGenerate = async () => {
    const description = featureDescription.trim();
    if (!description) return;
    beginSend(description);
    onClose();
    try {
      const ok = await onGenerate(description, attachments.length > 0 ? attachments : undefined);
      if (ok) {
        onSuccess();
      } else {
        if (mountedRef.current) onFailure();
      }
    } catch {
      if (mountedRef.current) onFailure();
    }
  };

  const onKeyDown = useSubmitShortcut(handleGenerate, {
    multiline: true,
    disabled: !featureDescription.trim(),
  });

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        void addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

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
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
          <h2 className="text-lg font-semibold text-theme-text">Add Plan</h2>
          <CloseButton onClick={onClose} ariaLabel="Close Add Plan modal" />
        </div>
        <div className="px-5 py-4">
          <textarea
            ref={featureInputRef}
            id="add-plan-feature-description"
            className="input w-full text-sm min-h-[100px] resize-y"
            value={featureDescription}
            onChange={(e) => setFeatureDescription(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Describe your feature idea…"
            aria-label="Describe your feature idea"
            data-testid="feature-description-input"
          />
          {/* Attachment list */}
          {attachments.length > 0 && (
            <ul className="mt-2 space-y-1" data-testid="attachment-list">
              {attachments.map((att, i) => (
                <li
                  key={`${att.name}-${i}`}
                  className="flex items-center gap-2 text-xs text-theme-text-secondary bg-theme-bg rounded px-2 py-1"
                >
                  <span className="truncate flex-1" title={att.name}>
                    {att.name}
                  </span>
                  <span className="shrink-0 text-theme-text-tertiary">
                    {formatFileSize(att.size)}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-theme-text-secondary hover:text-theme-error transition-colors"
                    onClick={() => removeAttachment(i)}
                    aria-label={`Remove ${att.name}`}
                    data-testid={`remove-attachment-${i}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="w-3.5 h-3.5"
                    >
                      <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {attachError && (
            <p className="mt-1 text-xs text-theme-error" data-testid="attach-error" role="alert">
              {attachError}
            </p>
          )}
          {dragOver && (
            <div
              className="mt-2 border-2 border-dashed border-theme-primary rounded-lg p-4 text-center text-sm text-theme-text-secondary"
              data-testid="drop-zone"
            >
              Drop files here
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-theme-border bg-theme-bg rounded-b-xl">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept={ACCEPT_STRING}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void addFiles(e.target.files);
              }
              e.target.value = "";
            }}
            data-testid="file-input"
            tabIndex={-1}
          />
          <span
            className="relative inline-flex"
            role="presentation"
            onMouseEnter={handleAttachTooltipMouseEnter}
            onMouseLeave={handleAttachTooltipMouseLeave}
          >
            <button
              ref={attachButtonRef}
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn-secondary h-10 w-10 shrink-0 p-0 flex items-center justify-center disabled:opacity-50"
              aria-label={ATTACH_CONTROL_LABEL}
              aria-describedby={attachTooltipVisible ? attachTooltipId : undefined}
              data-testid="attach-files-button"
              onFocus={() => {
                clearAttachTooltipHoverTimer();
                setAttachTooltipVisible(true);
              }}
              onBlur={hideAttachTooltip}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M11.986 3A2.743 2.743 0 0 0 10.05 3.8L4.05 9.8a1.243 1.243 0 0 0 1.757 1.757l4.5-4.5a.75.75 0 0 1 1.061 1.06l-4.5 4.5a2.743 2.743 0 1 1-3.879-3.878l6-6A4.243 4.243 0 0 1 15 8.744l-6 6a5.743 5.743 0 0 1-8.121-8.122l4.5-4.5a.75.75 0 0 1 1.06 1.061l-4.5 4.5a4.243 4.243 0 0 0 6 6l6-6A2.743 2.743 0 0 0 11.986 3Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            {attachTooltipVisible && (
              <div
                id={attachTooltipId}
                role="tooltip"
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1.5 text-xs font-normal
                  bg-theme-bg-elevated text-theme-text rounded-lg shadow-lg ring-1 ring-theme-border
                  max-w-[min(280px,calc(100vw-2rem))] text-center z-50 pointer-events-none
                  animate-fade-in"
              >
                {ATTACH_CONTROL_LABEL}
              </div>
            )}
          </span>
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
