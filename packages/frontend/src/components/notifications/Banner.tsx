import type { ReactNode } from "react";
import { NotificationIcon } from "./NotificationIcon";
import { DismissButton } from "./DismissButton";
import { getNotificationClasses, type NotificationSeverity } from "./notificationStyles";

export interface BannerProps {
  severity: NotificationSeverity;
  message: string;
  actions?: ReactNode;
  dismissable?: boolean;
  onDismiss?: () => void;
  testId?: string;
}

export function Banner({
  severity,
  message,
  actions,
  dismissable = false,
  onDismiss,
  testId,
}: BannerProps) {
  const colorClasses = getNotificationClasses(severity, "muted");

  return (
    <div
      className={`flex items-center justify-center gap-3 border-b px-4 py-3 shrink-0 ${colorClasses}`}
      data-testid={testId}
      role="alert"
    >
      <NotificationIcon severity={severity} size={16} />
      <p className="text-sm font-medium">{message}</p>
      {actions}
      {dismissable && onDismiss && <DismissButton onDismiss={onDismiss} variant="muted" />}
    </div>
  );
}
