import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { CONNECTION_TOAST_MESSAGE_PATTERN } from "../../lib/connectionNotificationConstants";
import type { ToastPosition } from "../../components/notifications/ToastStack";
import type { NotificationVariant } from "../../components/notifications/notificationStyles";

export type NotificationSeverity = "error" | "warning" | "info" | "success";
export type NotificationPresentation = "toast" | "inline";

export interface Notification {
  id: string;
  message: string;
  severity: NotificationSeverity;
  presentation?: NotificationPresentation;
  position?: ToastPosition;
  variant?: NotificationVariant;
  /** Auto-dismiss timeout in ms. 0 = persistent. Default: 8000 for info/success, 0 for error/warning. */
  timeout?: number;
  createdAt: number;
}

export interface AddNotificationPayload {
  message: string;
  severity?: NotificationSeverity;
  /** "toast" appears in floating stack; "inline" is reserved for context-specific rendering. */
  presentation?: NotificationPresentation;
  /** Where the toast appears. Default: "top-right". */
  position?: ToastPosition;
  /** Visual variant. Default: "bold". */
  variant?: NotificationVariant;
  /** Override auto-dismiss. 0 = persistent. */
  timeout?: number;
}

const DEFAULT_AUTO_DISMISS_MS = 8000;

function nextId(): string {
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getDefaultTimeout(severity: NotificationSeverity): number {
  return severity === "error" || severity === "warning" ? 0 : DEFAULT_AUTO_DISMISS_MS;
}

export interface NotificationState {
  items: Notification[];
}

const initialState: NotificationState = {
  items: [],
};

export const notificationSlice = createSlice({
  name: "notification",
  initialState,
  reducers: {
    addNotification(state, action: PayloadAction<AddNotificationPayload>) {
      const {
        message,
        severity = "info",
        presentation = "toast",
        position = "top-right",
        variant = "bold",
        timeout,
      } = action.payload;
      if (CONNECTION_TOAST_MESSAGE_PATTERN.test(message)) {
        const hasConnectionToast = state.items.some((n) =>
          CONNECTION_TOAST_MESSAGE_PATTERN.test(n.message)
        );
        if (hasConnectionToast) return;
      }
      const effectiveTimeout = timeout !== undefined ? timeout : getDefaultTimeout(severity);
      state.items.push({
        id: nextId(),
        message,
        severity,
        presentation,
        position,
        variant,
        timeout: effectiveTimeout,
        createdAt: Date.now(),
      });
    },
    dismissNotification(state, action: PayloadAction<string>) {
      state.items = state.items.filter((n) => n.id !== action.payload);
    },
    clearAllNotifications(state) {
      state.items = [];
    },
  },
});

export const { addNotification, dismissNotification, clearAllNotifications } =
  notificationSlice.actions;

export default notificationSlice.reducer;
