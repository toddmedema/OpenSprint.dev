import type { ReactElement } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MemoryRouter } from "react-router";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { Layout } from "./Layout";
import notificationReducer from "../../store/slices/notificationSlice";
import executeReducer from "../../store/slices/executeSlice";
import planReducer from "../../store/slices/planSlice";

vi.mock("../../api/client", () => ({
  api: {
    projects: { list: () => Promise.resolve([]) },
    agents: { active: () => Promise.resolve([]) },
  },
}));

const storage: Record<string, string> = {};
beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      Object.keys(storage).forEach((k) => delete storage[k]);
    },
    length: 0,
    key: () => null,
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
  Object.keys(storage).forEach((k) => delete storage[k]);
});

function createTestStore() {
  return configureStore({
    reducer: {
      notification: notificationReducer,
      execute: executeReducer,
      plan: planReducer,
    },
  });
}

function renderLayout(ui: ReactElement) {
  return render(
    <Provider store={createTestStore()}>
      <MemoryRouter>
        <ThemeProvider>{ui}</ThemeProvider>
      </MemoryRouter>
    </Provider>
  );
}

describe("Layout", () => {
  it("renders children in main", () => {
    renderLayout(
      <Layout>
        <span data-testid="child">Content</span>
      </Layout>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("has main with flex flex-col min-h-0 and overflow-hidden for independent phase scroll", () => {
    renderLayout(
      <Layout>
        <span>Content</span>
      </Layout>
    );
    const main = document.querySelector("main");
    expect(main).toBeInTheDocument();
    expect(main).toHaveClass("flex");
    expect(main).toHaveClass("flex-col");
    expect(main).toHaveClass("min-h-0");
    expect(main).toHaveClass("overflow-hidden");
  });
});
