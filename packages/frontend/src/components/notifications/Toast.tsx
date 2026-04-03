import { useEffect, useRef, type ReactNode } from "react";
import { NotificationIcon } from "./NotificationIcon";
import { DismissButton } from "./DismissButton";
import { getNotificationClasses, type NotificationSeverity } from "./notificationStyles";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastProps {
  severity: NotificationSeverity;
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

  const colorClasses = getNotificationClasses(severity, "muted");

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border shadow-lg backdrop-blur-sm animate-[slide-up-fade_0.25s_ease-out] ${colorClasses}`}
      data-testid={testId ?? `notification-${severity}`}
    >
      <span className="mt-0.5">{icon ?? <NotificationIcon severity={severity} size={16} />}</span>
      <span
        role="button"
        tabIndex={0}
        className="flex-1 min-w-0 text-sm font-medium cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-theme-accent focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
        onClick={onDismiss}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onDismiss();
          }
        }}
      >
        {message}
      </span>
      {actions?.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            a.onClick();
          }}
          className="shrink-0 text-sm font-semibold underline underline-offset-2 opacity-90 hover:opacity-100"
        >
          {a.label}
        </button>
      ))}
      <span className="shrink-0">
        <DismissButton onDismiss={onDismiss} variant="muted" />
      </span>
    </div>
  );
}
