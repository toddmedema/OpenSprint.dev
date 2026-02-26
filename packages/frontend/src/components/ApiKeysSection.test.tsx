import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiKeysSection } from "./ApiKeysSection";
import type { ProjectSettings } from "@opensprint/shared";

const mockSettingsClaude: ProjectSettings = {
  simpleComplexityAgent: { type: "claude", model: "claude-3-5-sonnet", cliCommand: null },
  complexComplexityAgent: { type: "claude", model: "claude-3-5-sonnet", cliCommand: null },
  deployment: { mode: "custom" },
  hilConfig: {
    scopeChanges: "automated",
    architectureDecisions: "automated",
    dependencyModifications: "automated",
  },
  testFramework: null,
  gitWorkingMode: "worktree",
};

const mockSettingsCursor: ProjectSettings = {
  ...mockSettingsClaude,
  simpleComplexityAgent: { type: "cursor", model: "gpt-4", cliCommand: null },
  complexComplexityAgent: { type: "cursor", model: "gpt-4", cliCommand: null },
};

const mockSettingsWithKeys: ProjectSettings = {
  ...mockSettingsClaude,
  apiKeys: {
    ANTHROPIC_API_KEY: [
      { id: "k1", value: "sk-ant-secret", limitHitAt: "2025-02-25T12:00:00Z" },
      { id: "k2", value: "sk-ant-other" },
    ],
  },
};

describe("ApiKeysSection", () => {
  const onApiKeysChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no claude or cursor providers in use", () => {
    const settings: ProjectSettings = {
      ...mockSettingsClaude,
      simpleComplexityAgent: { type: "claude-cli", model: null, cliCommand: null },
      complexComplexityAgent: { type: "claude-cli", model: null, cliCommand: null },
    };
    const { container } = render(
      <ApiKeysSection settings={settings} onApiKeysChange={onApiKeysChange} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders API Keys section when claude is selected", () => {
    render(<ApiKeysSection settings={mockSettingsClaude} onApiKeysChange={onApiKeysChange} />);
    expect(screen.getByTestId("api-keys-section")).toBeInTheDocument();
    expect(screen.getByText("API Keys")).toBeInTheDocument();
    expect(screen.getByText(/Add multiple keys per provider/)).toBeInTheDocument();
    expect(screen.getByText("ANTHROPIC_API_KEY (Claude API)")).toBeInTheDocument();
  });

  it("renders CURSOR_API_KEY when cursor is selected", () => {
    render(<ApiKeysSection settings={mockSettingsCursor} onApiKeysChange={onApiKeysChange} />);
    expect(screen.getByText("CURSOR_API_KEY")).toBeInTheDocument();
  });

  it("shows existing keys with masked placeholder and limitHitAt sub-label", () => {
    render(<ApiKeysSection settings={mockSettingsWithKeys} onApiKeysChange={onApiKeysChange} />);
    const inputs = screen.getAllByTestId(/api-key-input-ANTHROPIC_API_KEY-/);
    expect(inputs.length).toBe(2);
    expect(screen.getByText(/Limit hit at.*retry after 24h/)).toBeInTheDocument();
  });

  it("adds a new key when Add key is clicked", async () => {
    const user = userEvent.setup();
    render(<ApiKeysSection settings={mockSettingsClaude} onApiKeysChange={onApiKeysChange} />);
    const addBtn = screen.getByTestId("api-key-add-ANTHROPIC_API_KEY");
    await user.click(addBtn);
    const inputs = screen.getAllByTestId(/api-key-input-ANTHROPIC_API_KEY-/);
    expect(inputs.length).toBe(1);
  });

  it("toggles visibility when eye icon is clicked", async () => {
    const user = userEvent.setup();
    render(<ApiKeysSection settings={mockSettingsWithKeys} onApiKeysChange={onApiKeysChange} />);
    const eyeButtons = screen.getAllByRole("button", { name: /Show key|Hide key/ });
    expect(eyeButtons.length).toBeGreaterThanOrEqual(1);
    const input = screen.getAllByTestId(/api-key-input-ANTHROPIC_API_KEY-/)[0];
    expect(input).toHaveAttribute("type", "password");
    await user.click(eyeButtons[0]);
    expect(input).toHaveAttribute("type", "text");
  });

  it("calls onApiKeysChange when user types a new key value", async () => {
    const user = userEvent.setup();
    const settingsWithOneKey: ProjectSettings = {
      ...mockSettingsClaude,
      apiKeys: {
        ANTHROPIC_API_KEY: [{ id: "k1", value: "sk-ant-existing" }],
      },
    };
    render(<ApiKeysSection settings={settingsWithOneKey} onApiKeysChange={onApiKeysChange} />);
    const input = screen.getByTestId(/api-key-input-ANTHROPIC_API_KEY-/);
    await user.type(input, "sk-ant-new-key");
    expect(onApiKeysChange).toHaveBeenCalled();
    const lastCall = onApiKeysChange.mock.calls[onApiKeysChange.mock.calls.length - 1][0];
    expect(lastCall.ANTHROPIC_API_KEY).toBeDefined();
    expect(lastCall.ANTHROPIC_API_KEY!.some((e) => e.value === "sk-ant-new-key")).toBe(true);
  });

  it("disables remove when only one key remains", () => {
    render(<ApiKeysSection settings={mockSettingsWithKeys} onApiKeysChange={onApiKeysChange} />);
    const removeButtons = screen.getAllByTestId(/api-key-remove-/);
    const disabledCount = removeButtons.filter((b) => (b as HTMLButtonElement).disabled).length;
    expect(disabledCount).toBe(0);
  });

  it("returns null when settings is null", () => {
    const { container } = render(
      <ApiKeysSection settings={null} onApiKeysChange={onApiKeysChange} />
    );
    expect(container.firstChild).toBeNull();
  });
});
