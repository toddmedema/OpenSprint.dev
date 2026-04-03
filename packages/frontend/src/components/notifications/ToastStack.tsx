import type { ReactNode } from "react";

interface ToastStackProps {
  children: ReactNode;
  testId?: string;
}

export function ToastStack({ children, testId }: ToastStackProps) {
  return (
    <div
      className="fixed bottom-4 left-1/2 z-50 flex w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2"
      role="region"
      aria-label="Notifications"
      data-testid={testId ?? "notification-toast-stack"}
    >
      {children}
    </div>
  );
}
