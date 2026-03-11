import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MemoryRouter } from "react-router-dom";
import connectionReducer from "../store/slices/connectionSlice";
import { DatabaseStatusBanner } from "./DatabaseStatusBanner";

const mockUseDbStatus = vi.fn();

vi.mock("../api/hooks", () => ({
  useDbStatus: () => mockUseDbStatus(),
}));

function renderBanner(
  dbStatus: ReturnType<typeof mockUseDbStatus>,
  preloadedState?: { connection?: { connectionError: boolean } },
  route = "/"
) {
  mockUseDbStatus.mockReturnValue(dbStatus);
  const store = configureStore({
    reducer: {
      connection: (
        state = { connectionError: false },
        _action: { type: string; payload?: boolean }
      ) => state,
    },
    preloadedState,
  });

  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[route]}>
        <DatabaseStatusBanner />
      </MemoryRouter>
    </Provider>
  );
}

function renderBannerWithConnectionReducer(
  dbStatus: ReturnType<typeof mockUseDbStatus>,
  route = "/"
) {
  mockUseDbStatus.mockReturnValue(dbStatus);
  const store = configureStore({
    reducer: { connection: connectionReducer },
  });
  const wrapper = (
    <Provider store={store}>
      <MemoryRouter initialEntries={[route]}>
        <DatabaseStatusBanner />
      </MemoryRouter>
    </Provider>
  );
  return { ...render(wrapper), store };
}

describe("DatabaseStatusBanner", () => {
  it("renders nothing when database is connected", () => {
    renderBanner({
      data: { ok: true, state: "connected", lastCheckedAt: null },
      isPending: false,
    });
    expect(screen.queryByTestId("database-status-banner")).not.toBeInTheDocument();
  });

  it("shows the unavailable message and settings link", () => {
    const message =
      "The database server could not be reached; make sure PostgreSQL is running and the host and port in your settings are correct.";
    renderBanner({
      data: {
        ok: false,
        state: "disconnected",
        lastCheckedAt: null,
        message,
      },
      isPending: false,
    });

    expect(screen.getByTestId("database-status-banner")).toHaveTextContent(message);
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute(
      "href",
      "/settings"
    );
  });

  it("shows human-readable fallback when API returns no message", () => {
    renderBanner({
      data: {
        ok: false,
        state: "disconnected",
        lastCheckedAt: null,
        message: undefined,
      },
      isPending: false,
    });
    expect(screen.getByTestId("database-status-banner")).toHaveTextContent(
      "The database is not available; check Settings to fix the connection."
    );
  });

  it("shows reconnecting copy on project routes", () => {
    renderBanner(
      {
        data: {
          ok: false,
          state: "connecting",
          lastCheckedAt: null,
          message:
            "The database server could not be reached; make sure PostgreSQL is running and the host and port in your settings are correct.",
        },
        isPending: false,
      },
      undefined,
      "/projects/proj-1/plan"
    );

    expect(screen.getByTestId("database-status-banner")).toHaveTextContent(
      "Reconnecting to PostgreSQL..."
    );
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute(
      "href",
      "/projects/proj-1/settings"
    );
  });

  it("hides when the server itself is unreachable", () => {
    renderBanner(
      {
        data: {
          ok: false,
          state: "disconnected",
          lastCheckedAt: null,
          message:
            "The database server could not be reached; make sure PostgreSQL is running and the host and port in your settings are correct.",
        },
        isPending: false,
      },
      { connection: { connectionError: true } }
    );

    expect(screen.queryByTestId("database-status-banner")).not.toBeInTheDocument();
  });

  it("hides when db-status transitions to ok (connection restored)", () => {
    const { rerender, store } = renderBannerWithConnectionReducer({
      data: {
        ok: false,
        state: "connecting",
        lastCheckedAt: null,
        message: "Reconnecting to PostgreSQL...",
      },
      isPending: false,
    });
    expect(screen.getByTestId("database-status-banner")).toHaveTextContent(
      "Reconnecting to PostgreSQL..."
    );

    mockUseDbStatus.mockReturnValue({
      data: { ok: true, state: "connected", lastCheckedAt: null },
      isPending: false,
    });
    rerender(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/"]}>
          <DatabaseStatusBanner />
        </MemoryRouter>
      </Provider>
    );
    expect(screen.queryByTestId("database-status-banner")).not.toBeInTheDocument();
  });
});
