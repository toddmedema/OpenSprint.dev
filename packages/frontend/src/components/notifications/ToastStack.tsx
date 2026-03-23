import type { ReactNode } from "react";
import { NAVBAR_HEIGHT } from "../../lib/constants";
import { TOAST_SAFE_STYLE } from "../../lib/dropdownViewport";

export type ToastPosition = "top-right" | "bottom-right";

interface ToastStackProps {
  position?: ToastPosition;
  children: ReactNode;
  testId?: string;
}

export function ToastStack({ position = "top-right", children, testId }: ToastStackProps) {
  const isTop = position === "top-right";

  return (
    <div
      className="fixed right-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2"
      style={isTop ? { top: NAVBAR_HEIGHT + 8 } : TOAST_SAFE_STYLE}
      role="region"
      aria-label={isTop ? "Notifications" : "Status notifications"}
      data-testid={testId ?? `toast-stack-${position}`}
    >
      {children}
    </div>
  );
}
