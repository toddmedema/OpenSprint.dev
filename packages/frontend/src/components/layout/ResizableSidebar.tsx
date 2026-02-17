import { useState, useCallback, useRef } from "react";

const STORAGE_PREFIX = "opensprint-sidebar-width-";

export interface ResizableSidebarProps {
  /** Unique key for localStorage persistence (e.g. "plan", "build") */
  storageKey: string;
  /** Default width in pixels when no persisted value exists */
  defaultWidth?: number;
  /** Minimum width in pixels */
  minWidth?: number;
  /** Maximum width in pixels */
  maxWidth?: number;
  /** Sidebar content */
  children: React.ReactNode;
  /** Additional class names for the sidebar container */
  className?: string;
  /** Whether sidebar is visible (affects resize handle visibility) */
  visible?: boolean;
  /** When true, on mobile uses w-full max-w-[defaultWidth], on md+ uses persisted width */
  responsive?: boolean;
}

function loadPersistedWidth(storageKey: string, defaultWidth: number): number {
  if (typeof window === "undefined") return defaultWidth;
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // ignore
  }
  return defaultWidth;
}

function savePersistedWidth(storageKey: string, width: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_PREFIX + storageKey, String(width));
  } catch {
    // ignore
  }
}

/**
 * A right-side sidebar with a draggable left edge. Width is persisted to localStorage.
 * Used in Plan and Build phases for the plan detail and task detail panels.
 */
export function ResizableSidebar({
  storageKey,
  defaultWidth = 420,
  minWidth = 280,
  maxWidth = 800,
  children,
  className = "",
  visible = true,
  responsive = false,
}: ResizableSidebarProps) {
  const [width, setWidth] = useState(() =>
    loadPersistedWidth(storageKey, defaultWidth),
  );
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const currentWidthRef = useRef<number>(width);
  currentWidthRef.current = width;

  const onHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = width;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = startXRef.current - moveEvent.clientX;
        const newWidth = Math.round(
          Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + deltaX)),
        );
        currentWidthRef.current = newWidth;
        setWidth(newWidth);
      };

      const handleMouseUp = () => {
        savePersistedWidth(storageKey, currentWidthRef.current);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width, storageKey, minWidth, maxWidth],
  );

  const widthStyle = responsive
    ? { ["--sidebar-width" as string]: `${width}px` }
    : { width: visible ? width : 0, minWidth: visible ? width : 0 };

  const responsiveClasses = responsive
    ? "w-full max-w-[420px] md:max-w-none md:w-[var(--sidebar-width)]"
    : "";

  const borderClass = responsive ? "" : "border-l border-gray-200";

  return (
    <div
      className={`relative flex flex-col bg-gray-50 shrink-0 ${borderClass} ${responsiveClasses} ${className}`}
      style={widthStyle}
    >
      {visible && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          aria-label="Resize sidebar"
          onMouseDown={onHandleMouseDown}
          className={`absolute left-0 top-0 bottom-0 w-2 -ml-1 cursor-col-resize z-10 flex items-center justify-center group hover:bg-brand-500/10 ${responsive ? "hidden md:flex" : ""}`}
        >
          <div className="w-1 h-12 rounded-full bg-gray-300 group-hover:bg-brand-500/60 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      )}
      <div className="flex flex-col flex-1 min-w-0">{children}</div>
    </div>
  );
}
