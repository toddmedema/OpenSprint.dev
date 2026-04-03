import { describe, it, expect } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import notificationReducer, {
  addNotification,
  dismissNotification,
  clearAllNotifications,
} from "./notificationSlice";

function createStore() {
  return configureStore({
    reducer: { notification: notificationReducer },
  });
}

describe("notificationSlice", () => {
  it("has empty initial state", () => {
    const store = createStore();
    expect(store.getState().notification.items).toEqual([]);
  });

  it("addNotification adds a notification with default severity", () => {
    const store = createStore();
    store.dispatch(addNotification({ message: "Test message" }));
    const items = store.getState().notification.items;
    expect(items).toHaveLength(1);
    expect(items[0].message).toBe("Test message");
    expect(items[0].severity).toBe("info");
    expect(items[0].timeout).toBe(15000);
    expect(items[0].id).toMatch(/^notif-/);
    expect(items[0].createdAt).toBeGreaterThan(0);
  });

  it("addNotification with error severity uses default auto-dismiss timeout", () => {
    const store = createStore();
    store.dispatch(addNotification({ message: "Error!", severity: "error" }));
    const items = store.getState().notification.items;
    expect(items[0].severity).toBe("error");
    expect(items[0].timeout).toBe(15000);
  });

  it("addNotification with warning severity uses default auto-dismiss timeout", () => {
    const store = createStore();
    store.dispatch(addNotification({ message: "Warning!", severity: "warning" }));
    const items = store.getState().notification.items;
    expect(items[0].severity).toBe("warning");
    expect(items[0].timeout).toBe(15000);
  });

  it("addNotification with custom timeout", () => {
    const store = createStore();
    store.dispatch(addNotification({ message: "Custom", severity: "error", timeout: 5000 }));
    const items = store.getState().notification.items;
    expect(items[0].timeout).toBe(5000);
  });

  it("dismissNotification removes by id", () => {
    const store = createStore();
    store.dispatch(addNotification({ message: "A" }));
    store.dispatch(addNotification({ message: "B" }));
    const id = store.getState().notification.items[0].id;
    store.dispatch(dismissNotification(id));
    const items = store.getState().notification.items;
    expect(items).toHaveLength(1);
    expect(items[0].message).toBe("B");
  });

  it("clearAllNotifications removes all", () => {
    const store = createStore();
    store.dispatch(addNotification({ message: "A" }));
    store.dispatch(addNotification({ message: "B" }));
    store.dispatch(clearAllNotifications());
    expect(store.getState().notification.items).toEqual([]);
  });

  it("deduplicates connection-in-progress toasts: at most one visible", () => {
    const store = createStore();
    store.dispatch(
      addNotification({ message: "Reconnecting to PostgreSQL...", severity: "error" })
    );
    expect(store.getState().notification.items).toHaveLength(1);

    // Second connection toast should be skipped (banner already shown)
    store.dispatch(addNotification({ message: "Connecting to database...", severity: "error" }));
    expect(store.getState().notification.items).toHaveLength(1);

    // Non-connection toast should still be added
    store.dispatch(addNotification({ message: "Something else failed", severity: "error" }));
    expect(store.getState().notification.items).toHaveLength(2);
  });
});
