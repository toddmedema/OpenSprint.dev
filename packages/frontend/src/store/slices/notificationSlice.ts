import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { CONNECTION_TOAST_MESSAGE_PATTERN } from "../../lib/connectionNotificationConstants";

export type NotificationSeverity = "error" | "warning" | "info" | "success";
export type NotificationPresentation = "toast" | "inline";

export interface Notification {
  id: string;
  message: string;
  severity: NotificationSeverity;
  presentation?: NotificationPresentation;
  /** Auto-dismiss timeout in ms. 0 = persistent. Default: 15000 for all toasts. */
  timeout?: number;
  createdAt: number;
}

export interface AddNotificationPayload {
  message: string;
  severity?: NotificationSeverity;
  /** "toast" appears in floating stack; "inline" is reserved for context-specific rendering. */
  presentation?: NotificationPresentation;
  /** Override auto-dismiss. 0 = persistent. */
  timeout?: number;
}

const DEFAULT_AUTO_DISMISS_MS = 15000;

function nextId(): string {
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getDefaultTimeout(): number {
  return DEFAULT_AUTO_DISMISS_MS;
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
      const { message, severity = "info", presentation = "toast", timeout } = action.payload;
      if (CONNECTION_TOAST_MESSAGE_PATTERN.test(message)) {
        const hasConnectionToast = state.items.some((n) =>
          CONNECTION_TOAST_MESSAGE_PATTERN.test(n.message)
        );
        if (hasConnectionToast) return;
      }
      const effectiveTimeout = timeout !== undefined ? timeout : getDefaultTimeout();
      state.items.push({
        id: nextId(),
        message,
        severity,
        presentation,
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
