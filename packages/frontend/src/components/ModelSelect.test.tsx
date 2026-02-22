import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModelSelect } from "./ModelSelect";

const mockModelsList = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    models: {
      list: (...args: unknown[]) => mockModelsList(...args),
    },
  },
}));

describe("ModelSelect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders custom provider as text input", () => {
    render(<ModelSelect provider="custom" value={null} onChange={() => {}} />);
    expect(screen.getByPlaceholderText("CLI command handles model")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /custom cli command/i })).toBeInTheDocument();
  });

  it("shows loading state for claude provider", () => {
    mockModelsList.mockImplementation(() => new Promise(() => {}));
    render(<ModelSelect provider="claude" value={null} onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: /model selection/i })).toBeInTheDocument();
    expect(screen.getByText("Loading models…")).toBeInTheDocument();
  });

  it("shows error state when models list fails", async () => {
    mockModelsList.mockRejectedValue(new Error("Invalid API key"));
    render(<ModelSelect provider="claude" value={null} onChange={() => {}} />);
    await screen.findByText(/Invalid API key/);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders model options and calls onChange when selection changes", async () => {
    mockModelsList.mockResolvedValue([
      { id: "claude-3-5-sonnet", displayName: "Claude 3.5 Sonnet" },
      { id: "claude-3-opus", displayName: "Claude 3 Opus" },
    ]);
    const onChange = vi.fn();
    render(<ModelSelect provider="claude" value={null} onChange={onChange} />);
    await screen.findByText("Claude 3.5 Sonnet");
    const select = screen.getByRole("combobox", { name: /model selection/i });
    fireEvent.change(select, { target: { value: "claude-3-opus" } });
    expect(onChange).toHaveBeenCalledWith("claude-3-opus");
  });

  it("shows No models available when list is empty", async () => {
    mockModelsList.mockResolvedValue([]);
    render(<ModelSelect provider="cursor" value={null} onChange={() => {}} />);
    await screen.findByText("No models available");
  });
});
