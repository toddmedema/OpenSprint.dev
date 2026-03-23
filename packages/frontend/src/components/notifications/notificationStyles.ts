export type NotificationVariant = "bold" | "muted";
export type NotificationSeverity = "error" | "warning" | "info" | "success";

const BOLD: Record<NotificationSeverity, string> = {
  error: "bg-theme-notification-error text-white border-theme-notification-error/70",
  warning: "bg-theme-notification-warning text-white border-theme-notification-warning/70",
  info: "bg-theme-notification-info text-white border-theme-notification-info/70",
  success: "bg-theme-notification-success text-white border-theme-notification-success/70",
};

const MUTED: Record<NotificationSeverity, string> = {
  error: "bg-theme-error-bg text-theme-error-text border-theme-error-border",
  warning: "bg-theme-warning-bg text-theme-warning-text border-theme-warning-border",
  info: "bg-theme-info-bg text-theme-info-text border-theme-info-border",
  success: "bg-theme-success-bg text-theme-success-text border-theme-success-border",
};

export function getNotificationClasses(
  severity: NotificationSeverity,
  variant: NotificationVariant
): string {
  return variant === "bold" ? BOLD[severity] : MUTED[severity];
}
