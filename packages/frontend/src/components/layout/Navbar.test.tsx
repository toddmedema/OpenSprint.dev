import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { Navbar } from "./Navbar";
import executeReducer from "../../store/slices/executeSlice";
import planReducer from "../../store/slices/planSlice";

const mockGetSettings = vi.fn();
vi.mock("../../api/client", () => ({
  api: {
    projects: {
      list: vi.fn().mockResolvedValue([]),
      getSettings: (...args: unknown[]) => mockGetSettings(...args),
    },
    agents: { active: vi.fn().mockResolvedValue([]) },
    env: { getKeys: vi.fn().mockResolvedValue({ anthropic: true, cursor: true }) },
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
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
  Object.keys(storage).forEach((k) => delete storage[k]);
});

function renderNavbar(ui: ReactElement) {
  return render(
    <ThemeProvider>
      <Provider store={createStore()}>
        <MemoryRouter>{ui}</MemoryRouter>
      </Provider>
    </ThemeProvider>,
  );
}

function createStore() {
  return configureStore({
    reducer: { execute: executeReducer, plan: planReducer },
  });
}

describe("Navbar", () => {
  it("has z-[60] so dropdowns appear above Build sidebar (z-50)", () => {
    renderNavbar(<Navbar project={null} />);

    const nav = screen.getByRole("navigation");
    expect(nav).toHaveClass("z-[60]");
  });

  it("renders theme toggle with Light, Dark, System options", () => {
    renderNavbar(<Navbar project={null} />);

    expect(screen.getByTestId("navbar-theme-light")).toBeInTheDocument();
    expect(screen.getByTestId("navbar-theme-dark")).toBeInTheDocument();
    expect(screen.getByTestId("navbar-theme-system")).toBeInTheDocument();
  });

  it("applies theme when user selects from navbar toggle", async () => {
    const user = userEvent.setup();
    renderNavbar(<Navbar project={null} />);

    await user.click(screen.getByTestId("navbar-theme-dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("opensprint.theme")).toBe("dark");

    await user.click(screen.getByTestId("navbar-theme-light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("opensprint.theme")).toBe("light");
  });

  it("navbar and settings theme picker stay in sync when changed from settings", async () => {
    const user = userEvent.setup();
    const mockProject = {
      id: "proj-1",
      name: "Test",
      description: "",
      repoPath: "/path",
      currentPhase: "sketch" as const,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    };
    mockGetSettings.mockResolvedValue({
      planningAgent: { type: "claude", model: "claude-3-5-sonnet", cliCommand: null },
      codingAgent: { type: "claude", model: "claude-3-5-sonnet", cliCommand: null },
      deployment: { mode: "custom" },
      hilConfig: {
        scopeChanges: "requires_approval",
        architectureDecisions: "requires_approval",
        dependencyModifications: "requires_approval",
      },
    });

    const onSettingsOpenChange = vi.fn();
    renderNavbar(
      <Navbar
        project={mockProject}
        settingsOpen={true}
        onSettingsOpenChange={onSettingsOpenChange}
      />,
    );

    await screen.findByText("Project Settings");
    const displayTab = screen.getByRole("button", { name: "Display" });
    await user.click(displayTab);

    await user.click(screen.getByTestId("theme-option-dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByTestId("navbar-theme-dark")).toHaveClass("bg-brand-600");
  });
});
