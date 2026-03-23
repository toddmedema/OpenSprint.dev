import { useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { dismissNotification, type Notification } from "../store/slices/notificationSlice";
import { Toast, ToastStack } from "./notifications";
import type { NotificationSeverity, NotificationVariant } from "./notifications";

export function NotificationBar() {
  const dispatch = useAppDispatch();
  const notifications = useAppSelector((state) => state.notification.items);

  const toasts = useMemo(
    () => notifications.filter((item) => item.presentation !== "inline"),
    [notifications]
  );

  const topRight = useMemo(
    () => toasts.filter((t) => (t.position ?? "top-right") === "top-right"),
    [toasts]
  );
  const bottomRight = useMemo(() => toasts.filter((t) => t.position === "bottom-right"), [toasts]);

  const handleDismiss = useCallback((id: string) => dispatch(dismissNotification(id)), [dispatch]);

  return (
    <>
      {topRight.length > 0 && (
        <ToastStack position="top-right" testId="notification-toast-stack">
          {topRight.map((n) => (
            <ToastItem key={n.id} notification={n} onDismiss={() => handleDismiss(n.id)} />
          ))}
        </ToastStack>
      )}
      {bottomRight.length > 0 && (
        <ToastStack position="bottom-right" testId="toast-stack-bottom-right">
          {bottomRight.map((n) => (
            <ToastItem key={n.id} notification={n} onDismiss={() => handleDismiss(n.id)} />
          ))}
        </ToastStack>
      )}
    </>
  );
}

function ToastItem({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: () => void;
}) {
  return (
    <Toast
      severity={notification.severity as NotificationSeverity}
      variant={(notification.variant ?? "bold") as NotificationVariant}
      message={notification.message}
      onDismiss={onDismiss}
      timeout={notification.timeout}
      testId={`notification-${notification.severity}`}
    />
  );
}
