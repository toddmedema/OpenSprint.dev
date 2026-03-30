import { useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { dismissNotification } from "../store/slices/notificationSlice";
import { Toast, ToastStack } from "./notifications";
import type { NotificationSeverity } from "./notifications";

export function NotificationBar() {
  const dispatch = useAppDispatch();
  const notifications = useAppSelector((state) => state.notification.items);

  const toasts = useMemo(
    () => notifications.filter((item) => item.presentation !== "inline"),
    [notifications]
  );

  const handleDismiss = useCallback((id: string) => dispatch(dismissNotification(id)), [dispatch]);

  if (toasts.length === 0) return null;

  return (
    <ToastStack>
      {toasts.map((n) => (
        <Toast
          key={n.id}
          severity={n.severity as NotificationSeverity}
          message={n.message}
          onDismiss={() => handleDismiss(n.id)}
          timeout={n.timeout}
          testId={`notification-${n.severity}`}
        />
      ))}
    </ToastStack>
  );
}
