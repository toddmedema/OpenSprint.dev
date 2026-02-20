import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import notificationReducer from "../store/slices/notificationSlice";
import { NotificationBar } from "./NotificationBar";

function createStore(initialItems: { id: string; message: string; severity: string }[] = []) {
  return configureStore({
    reducer: { notification: notificationReducer },
    preloadedState: {
      notification: {
        items: initialItems.map((i) => ({
          ...i,
          timeout: i.severity === "error" || i.severity === "warning" ? 0 : 8000,
          createdAt: Date.now(),
        })),
      },
    },
  });
}

describe("NotificationBar", () => {
  it("renders nothing when no notifications", () => {
    const store = createStore();
    const { container } = render(
      <Provider store={store}>
        <NotificationBar />
      </Provider>
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders notification with message and dismiss button", async () => {
    const user = userEvent.setup();
    const store = createStore([{ id: "n1", message: "Something went wrong", severity: "error" }]);
    render(
      <Provider store={store}>
        <NotificationBar />
      </Provider>
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
    expect(dismissBtn).toBeInTheDocument();
    await user.click(dismissBtn);
    expect(store.getState().notification.items).toHaveLength(0);
  });

  it("has role=alert on notification", () => {
    const store = createStore([{ id: "n1", message: "Alert", severity: "error" }]);
    render(
      <Provider store={store}>
        <NotificationBar />
      </Provider>
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Alert");
  });

  it("renders multiple notifications stacked", () => {
    const store = createStore([
      { id: "n1", message: "First", severity: "error" },
      { id: "n2", message: "Second", severity: "info" },
    ]);
    render(
      <Provider store={store}>
        <NotificationBar />
      </Provider>
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("is keyboard dismissable with Escape", async () => {
    const user = userEvent.setup();
    const store = createStore([{ id: "n1", message: "Test", severity: "error" }]);
    render(
      <Provider store={store}>
        <NotificationBar />
      </Provider>
    );
    const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
    dismissBtn.focus();
    await user.keyboard("{Escape}");
    expect(store.getState().notification.items).toHaveLength(0);
  });
});
