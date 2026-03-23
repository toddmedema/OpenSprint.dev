import { useEffect, useRef, type ReactNode } from "react";
import { NotificationIcon } from "./NotificationIcon";
import { DismissButton } from "./DismissButton";
import {
  getNotificationClasses,
  type NotificationSeverity,
  type NotificationVariant,
} from "./notificationStyles";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastProps {
  severity: NotificationSeverity;
  variant?: NotificationVariant;
  message: string;
  onDismiss: () => void;
  actions?: ToastAction[];
  icon?: ReactNode;
  /** Auto-dismiss timeout in ms. 0 = persistent. */
  timeout?: number;
  testId?: string;
}

export function Toast({
  severity,
  variant = "bold",
  message,
  onDismiss,
  actions,
  icon,
  timeout,
  testId,
}: ToastProps) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeout && timeout > 0) {
      timeoutRef.current = setTimeout(onDismiss, timeout);
    }
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [timeout, onDismiss]);

  const colorClasses = getNotificationClasses(severity, variant);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border shadow-lg backdrop-blur-sm animate-[slide-up-fade_0.25s_ease-out] ${colorClasses}`}
      data-testid={testId ?? `notification-${severity}`}
    >
      <span className="mt-0.5">{icon ?? <NotificationIcon severity={severity} size={16} />}</span>
      <span className="flex-1 min-w-0 text-sm font-medium">{message}</span>
      {actions?.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={a.onClick}
          className="shrink-0 text-sm font-semibold underline underline-offset-2 opacity-90 hover:opacity-100"
        >
          {a.label}
        </button>
      ))}
      <DismissButton onDismiss={onDismiss} variant={variant} />
    </div>
  );
}
