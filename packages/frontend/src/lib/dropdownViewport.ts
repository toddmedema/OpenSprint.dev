/**
 * Viewport-safe positioning for dropdowns and popovers.
 * Ensures max-height 90vh, overflow-y-auto, safe insets, and bottom-up on mobile when needed.
 */

import type { CSSProperties } from "react";
import { MOBILE_BREAKPOINT } from "./constants";
import { DROPDOWN_PORTAL_Z_INDEX } from "./constants";

/** Safe inset (px) from viewport edges to avoid cutoff on mobile. */
const SAFE_INSET = 8;

/** Default max height for dropdown content (matches 90vh). */
export const DROPDOWN_MAX_HEIGHT = "90vh";

export interface DropdownPositionOptions {
  minWidth?: number;
  /** Estimated dropdown height for bottom-up decision (px). */
  estimatedHeight?: number;
}

/**
 * Computes viewport-safe positioning for a right-aligned dropdown anchored to a trigger rect.
 * On mobile (< MOBILE_BREAKPOINT), uses bottom-up when space below is insufficient.
 */
export function getDropdownPositionRightAligned(
  anchorRect: DOMRect,
  options?: DropdownPositionOptions
): CSSProperties {
  const { minWidth = 220, estimatedHeight = 280 } = options ?? {};
  const isMobile = typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT;
  const vh = typeof window !== "undefined" ? window.innerHeight : 600;
  const vw = typeof window !== "undefined" ? window.innerWidth : 400;

  const spaceBelow = vh - anchorRect.bottom - SAFE_INSET;
  const spaceAbove = anchorRect.top - SAFE_INSET;
  const useBottomUp = isMobile && spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

  const right = vw - anchorRect.right;
  const maxWidth = anchorRect.right - SAFE_INSET;

  const base = {
    position: "fixed" as const,
    right,
    minWidth,
    maxWidth: `${maxWidth}px`,
    maxHeight: "90vh",
    overflowY: "auto" as const,
    zIndex: DROPDOWN_PORTAL_Z_INDEX,
  };

  if (useBottomUp) {
    return { ...base, bottom: vh - anchorRect.top + 4 };
  }
  return { ...base, top: anchorRect.bottom + 4 };
}

/**
 * Computes viewport-safe positioning for a left-aligned dropdown (e.g. project card kebab menu).
 */
export function getDropdownPositionLeftAligned(
  anchorRect: DOMRect,
  options?: DropdownPositionOptions
): CSSProperties {
  const { minWidth = 140, estimatedHeight = 120 } = options ?? {};
  const isMobile = typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT;
  const vh = typeof window !== "undefined" ? window.innerHeight : 600;
  const vw = typeof window !== "undefined" ? window.innerWidth : 400;

  const spaceBelow = vh - anchorRect.bottom - SAFE_INSET;
  const spaceAbove = anchorRect.top - SAFE_INSET;
  const useBottomUp = isMobile && spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

  const left = Math.max(
    SAFE_INSET,
    Math.min(anchorRect.right - minWidth, vw - minWidth - SAFE_INSET)
  );

  const base = {
    position: "fixed" as const,
    left,
    minWidth,
    maxWidth: `${vw - left - SAFE_INSET}px`,
    maxHeight: "90vh",
    overflowY: "auto" as const,
    zIndex: DROPDOWN_PORTAL_Z_INDEX,
  };

  if (useBottomUp) {
    return { ...base, bottom: vh - anchorRect.top + 4 };
  }
  return { ...base, top: anchorRect.bottom + 4 };
}

/**
 * CSS classes for viewport-safe dropdown containers.
 */
export const DROPDOWN_VIEWPORT_CLASSES = "max-h-[90vh] overflow-y-auto" as const;

/**
 * Inline style for toast/notification fixed positioning with safe insets.
 * Uses env(safe-area-inset-*) when available for notched devices.
 */
export const TOAST_SAFE_STYLE: CSSProperties = {
  bottom: "max(1rem, env(safe-area-inset-bottom, 1rem))",
  right: "max(1rem, env(safe-area-inset-right, 1rem))",
};
