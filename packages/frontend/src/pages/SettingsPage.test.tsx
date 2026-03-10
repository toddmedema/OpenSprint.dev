import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import { SettingsPage } from "./SettingsPage";
import { renderApp } from "../test/test-utils";

const mockGetKeys = vi.fn();
const mockGlobalSettingsGet = vi.fn();

const mockGlobalSettingsPut = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    env: {
      getKeys: () => mockGetKeys(),
    },
    globalSettings: {
      get: () => mockGlobalSettingsGet(),
      put: (...args: unknown[]) => mockGlobalSettingsPut(...args),
    },
  },
}));

vi.mock("../components/layout/Layout", () => ({
  Layout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

function renderSettingsPage() {
  return renderApp(
    <Routes>
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>,
    { routeEntries: ["/settings"] }
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    mockGetKeys.mockResolvedValue({
      anthropic: true,
      cursor: true,
      openai: true,
      claudeCli: true,
      useCustomCli: false,
    });
    mockGlobalSettingsGet.mockResolvedValue({ databaseUrl: "" });
  });

  it("renders the settings page shell and global settings content", async () => {
    renderSettingsPage();

    await waitFor(() => {
      expect(screen.getByTestId("settings-page")).toBeInTheDocument();
    });

    const page = screen.getByTestId("settings-page");
    expect(page).toHaveClass("bg-theme-surface");

    const topBar = screen.getByTestId("settings-top-bar");
    expect(topBar).toBeInTheDocument();
    expect(topBar).toHaveClass("py-0");
    expect(topBar).toHaveClass("items-stretch");
    expect(screen.getByTestId("settings-global-tab")).toHaveTextContent("Global");
    expect(screen.queryByTestId("settings-project-tab")).not.toBeInTheDocument();
    expect(screen.getByTestId("global-settings-content")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Back to home" })).not.toBeInTheDocument();
    expect(screen.getByTestId("settings-save-indicator")).toHaveTextContent("Saved");
  });

  it("registers beforeunload when save in progress", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    mockGlobalSettingsGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                databaseUrl: "postgresql://user:***@localhost:5432/opensprint",
                apiKeys: undefined,
              }),
            0
          );
        })
    );
    mockGlobalSettingsPut.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ databaseUrl: "", apiKeys: undefined }), 100)
        )
    );

    renderSettingsPage();

    await waitFor(() => {
      expect(screen.getByTestId("database-url-input")).toBeInTheDocument();
    });

    const input = screen.getByTestId("database-url-input");
    fireEvent.change(input, {
      target: { value: "postgresql://user:secret@localhost:5432/opensprint" },
    });

    await waitFor(
      () => {
        expect(screen.getByTestId("settings-save-indicator")).toHaveTextContent("Saving");
      },
      { timeout: 1000 }
    );

    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    await waitFor(
      () => {
        expect(screen.getByTestId("settings-save-indicator")).toHaveTextContent("Saved");
      },
      { timeout: 2500 }
    );

    await waitFor(
      () => {
        expect(removeSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
      },
      { timeout: 500 }
    );

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
