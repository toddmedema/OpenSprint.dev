import type { ReactNode } from "react";
import { PHASE_TOOLBAR_HEIGHT } from "../../lib/constants";

interface FilterBarProps {
  left: ReactNode;
  right?: ReactNode;
  dataTestId?: string;
  /** When "phase", bar height matches top nav (48px); smaller padding and controls. */
  variant?: "default" | "phase";
}

export function FilterBar({ left, right, dataTestId, variant = "default" }: FilterBarProps) {
  const isPhase = variant === "phase";
  return (
    <div
      className={
        isPhase
          ? "phase-toolbar w-full px-4 sm:px-6 flex items-center py-0.5 border-b border-theme-border bg-theme-surface shrink-0"
          : "w-full px-4 sm:px-6 min-h-[48px] flex items-center py-2 border-b border-theme-border-subtle bg-theme-surface shrink-0"
      }
      style={isPhase ? { height: PHASE_TOOLBAR_HEIGHT } : undefined}
      data-testid={dataTestId}
    >
      <div className="flex w-full items-center justify-between gap-2 sm:gap-4">
        <div className={`flex items-center gap-2 flex-1 min-w-0 overflow-x-auto overflow-y-visible flex-nowrap ${isPhase ? "py-0" : "py-1"}`}>
          {left}
        </div>
        {right ? <div className="flex items-center shrink-0 gap-1 sm:gap-2">{right}</div> : null}
      </div>
    </div>
  );
}

