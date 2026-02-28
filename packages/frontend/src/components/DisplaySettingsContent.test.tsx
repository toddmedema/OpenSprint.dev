import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DisplaySettingsContent } from "./DisplaySettingsContent";

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({
    preference: "light",
    setTheme: vi.fn(),
  }),
}));

vi.mock("../contexts/DisplayPreferencesContext", () => ({
  useDisplayPreferences: () => ({
    runningAgentsDisplayMode: "count",
    setRunningAgentsDisplayMode: vi.fn(),
  }),
}));

const mockGetKeys = vi.fn();
const mockValidateKey = vi.fn();
const mockSaveKey = vi.fn();
const mockGlobalSettingsGet = vi.fn();
const mockGlobalSettingsPut = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    env: {
      getKeys: () => mockGetKeys(),
      validateKey: (...args: unknown[]) => mockValidateKey(...args),
      saveKey: (...args: unknown[]) => mockSaveKey(...args),
    },
    globalSettings: {
      get: () => mockGlobalSettingsGet(),
      put: (...args: unknown[]) => mockGlobalSettingsPut(...args),
    },
  },
  isConnectionError: () => false,
}));

describe("DisplaySettingsContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetKeys.mockResolvedValue({
      anthropic: false,
      cursor: false,
      claudeCli: false,
      useCustomCli: false,
    });
    mockGlobalSettingsGet.mockResolvedValue({
      databaseUrl: "postgresql://user:***@localhost:5432/opensprint",
    });
  });

  it("renders Agent API Keys section with add inputs when keys not configured", async () => {
    render(<DisplaySettingsContent />);

    expect(screen.getByText("Agent API Keys")).toBeInTheDocument();
    expect(screen.getByText(/Configure API keys for Claude and Cursor/)).toBeInTheDocument();
    expect(await screen.findByTestId("global-api-key-anthropic-input")).toBeInTheDocument();
    expect(screen.getByTestId("global-api-key-cursor-input")).toBeInTheDocument();
    expect(screen.getByTestId("global-api-key-anthropic-save")).toBeInTheDocument();
    expect(screen.getByTestId("global-api-key-cursor-save")).toBeInTheDocument();
  });

  it("shows configured status when keys exist", async () => {
    mockGetKeys.mockResolvedValue({
      anthropic: true,
      cursor: true,
      claudeCli: false,
      useCustomCli: false,
    });

    render(<DisplaySettingsContent />);

    await screen.findByText("Agent API Keys");
    expect(screen.getByText("Claude: configured")).toBeInTheDocument();
    expect(screen.getByText("Cursor: configured")).toBeInTheDocument();
    expect(screen.queryByTestId("global-api-key-anthropic-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("global-api-key-cursor-input")).not.toBeInTheDocument();
  });

  it("shows Claude input only when anthropic not configured", async () => {
    mockGetKeys.mockResolvedValue({
      anthropic: false,
      cursor: true,
      claudeCli: false,
      useCustomCli: false,
    });

    render(<DisplaySettingsContent />);

    await screen.findByText("Agent API Keys");
    expect(screen.getByTestId("global-api-key-anthropic-input")).toBeInTheDocument();
    expect(screen.queryByTestId("global-api-key-cursor-input")).not.toBeInTheDocument();
    expect(screen.getByText("Cursor: configured")).toBeInTheDocument();
  });

  it("renders Theme section", async () => {
    render(<DisplaySettingsContent />);

    await screen.findByText("Theme");
    expect(screen.getByText(/Choose how Open Sprint looks/)).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-light")).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-dark")).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-system")).toBeInTheDocument();
  });

  it("renders Running agents display mode section", async () => {
    render(<DisplaySettingsContent />);

    await screen.findByText("Running agents display mode");
    expect(screen.getByTestId("running-agents-display-mode")).toBeInTheDocument();
  });

  it("renders Database URL section with masked value", async () => {
    render(<DisplaySettingsContent />);

    await screen.findByTestId("database-url-section");
    expect(screen.getByText("Database URL")).toBeInTheDocument();
    expect(
      screen.getByText(/PostgreSQL connection URL for tasks, feedback, and sessions/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Password is hidden in display/)).toBeInTheDocument();
    const input = screen.getByTestId("database-url-input");
    expect(input).toHaveAttribute("placeholder", "postgresql://user:password@host:port/database");
    expect(input).toHaveValue("postgresql://user:***@localhost:5432/opensprint");
    expect(screen.getByTestId("database-url-save")).toBeInTheDocument();
  });

  it("saves database URL on Save click", async () => {
    mockGlobalSettingsPut.mockResolvedValue({
      databaseUrl: "postgresql://user:***@db.example.com:5432/opensprint",
    });

    render(<DisplaySettingsContent />);

    await screen.findByTestId("database-url-input");
    const input = screen.getByTestId("database-url-input");
    fireEvent.change(input, {
      target: { value: "postgresql://user:secret@db.example.com:5432/opensprint" },
    });
    fireEvent.click(screen.getByTestId("database-url-save"));

    expect(mockGlobalSettingsPut).toHaveBeenCalledWith({
      databaseUrl: "postgresql://user:secret@db.example.com:5432/opensprint",
    });
    await waitFor(() => {
      expect(input).toHaveValue("postgresql://user:***@db.example.com:5432/opensprint");
    });
  });

  it("shows error when saving masked URL", async () => {
    render(<DisplaySettingsContent />);

    const saveBtn = await screen.findByTestId("database-url-save");
    fireEvent.click(saveBtn);

    expect(mockGlobalSettingsPut).not.toHaveBeenCalled();
    expect(screen.getByText("Enter the full connection URL to save changes")).toBeInTheDocument();
  });
});
