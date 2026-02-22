import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentsStep } from "./AgentsStep";

vi.mock("../../api/client", () => ({
  api: {
    models: {
      list: vi.fn().mockResolvedValue([]),
    },
  },
}));

const defaultPlanningAgent = {
  type: "cursor" as const,
  model: "",
  cliCommand: "",
};
const defaultCodingAgent = {
  type: "cursor" as const,
  model: "",
  cliCommand: "",
};

function renderAgentsStep(overrides: Partial<Parameters<typeof AgentsStep>[0]> = {}) {
  return render(
    <AgentsStep
      planningAgent={defaultPlanningAgent}
      codingAgent={defaultCodingAgent}
      onPlanningAgentChange={() => {}}
      onCodingAgentChange={() => {}}
      envKeys={null}
      keyInput={{ anthropic: "", cursor: "" }}
      onKeyInputChange={() => {}}
      savingKey={null}
      onSaveKey={() => {}}
      modelRefreshTrigger={0}
      maxConcurrentCoders={1}
      onMaxConcurrentCodersChange={() => {}}
      unknownScopeStrategy="optimistic"
      onUnknownScopeStrategyChange={() => {}}
      {...overrides}
    />
  );
}

describe("AgentsStep", () => {
  it("renders agents step with Planning Agent and Coding Agent sections", () => {
    renderAgentsStep();

    expect(screen.getByTestId("agents-step")).toBeInTheDocument();
    expect(screen.getByText("Planning Agent Slot")).toBeInTheDocument();
    expect(screen.getByText("Coding Agent Slot")).toBeInTheDocument();
  });

  it("hides API key banner when all keys for selected providers are configured", () => {
    renderAgentsStep({
      envKeys: { anthropic: true, cursor: true, claudeCli: true },
    });

    expect(screen.queryByText(/API key required/)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("sk-ant-...")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("key_...")).not.toBeInTheDocument();
  });

  it("shows cursor key input when cursor is selected and key is missing", () => {
    renderAgentsStep({
      envKeys: { anthropic: true, cursor: false, claudeCli: true },
    });

    expect(screen.getByText(/API key required/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("sk-ant-...")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("key_...")).toBeInTheDocument();
  });

  it("does not show anthropic key input when no agent uses claude provider", () => {
    renderAgentsStep({
      envKeys: { anthropic: false, cursor: true, claudeCli: true },
    });

    expect(screen.queryByText(/API key required/)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("sk-ant-...")).not.toBeInTheDocument();
  });

  it("shows anthropic key input when an agent uses claude provider and key is missing", () => {
    renderAgentsStep({
      planningAgent: { type: "claude", model: "", cliCommand: "" },
      envKeys: { anthropic: false, cursor: true, claudeCli: true },
    });

    expect(screen.getByText(/API key required/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("sk-ant-...")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("key_...")).not.toBeInTheDocument();
  });

  it("shows both key inputs when both providers are selected and both keys missing", () => {
    renderAgentsStep({
      planningAgent: { type: "claude", model: "", cliCommand: "" },
      envKeys: { anthropic: false, cursor: false, claudeCli: true },
    });

    expect(screen.getByText(/API key required/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("sk-ant-...")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("key_...")).toBeInTheDocument();
  });

  it("only shows cursor key when both agents use cursor and both keys missing", () => {
    renderAgentsStep({
      envKeys: { anthropic: false, cursor: false, claudeCli: true },
    });

    expect(screen.getByText(/API key required/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("sk-ant-...")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("key_...")).toBeInTheDocument();
  });

  it("does not show API key section when envKeys is null", () => {
    renderAgentsStep({ envKeys: null });

    expect(screen.queryByText(/API key required/)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("sk-ant-...")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("key_...")).not.toBeInTheDocument();
  });

  it("does not require API key when claude-cli is selected", () => {
    renderAgentsStep({
      planningAgent: { type: "claude-cli", model: "", cliCommand: "" },
      envKeys: { anthropic: false, cursor: true, claudeCli: true },
    });

    expect(screen.queryByText(/API key required/)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("sk-ant-...")).not.toBeInTheDocument();
  });

  it("shows CLI warning when claude-cli is selected and CLI is not available", () => {
    renderAgentsStep({
      planningAgent: { type: "claude-cli", model: "", cliCommand: "" },
      envKeys: { anthropic: false, cursor: true, claudeCli: false },
    });

    expect(screen.getByText(/Claude CLI not found/)).toBeInTheDocument();
    expect(screen.queryByText(/API key required/)).not.toBeInTheDocument();
  });

  it("shows CLI info when claude-cli is selected and CLI is available", () => {
    renderAgentsStep({
      planningAgent: { type: "claude-cli", model: "", cliCommand: "" },
      envKeys: { anthropic: true, cursor: true, claudeCli: true },
    });

    expect(screen.getByText(/locally-installed Claude CLI/)).toBeInTheDocument();
    expect(screen.queryByText(/Claude CLI not found/)).not.toBeInTheDocument();
  });

  it("renders parallelism section with slider defaulting to 1", () => {
    renderAgentsStep();

    expect(screen.getByText("Parallelism")).toBeInTheDocument();
    const slider = screen.getByTestId("max-concurrent-coders-slider");
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveValue("1");
  });

  it("calls onMaxConcurrentCodersChange when slider changes", () => {
    const onChange = vi.fn();
    renderAgentsStep({ onMaxConcurrentCodersChange: onChange });

    const slider = screen.getByTestId("max-concurrent-coders-slider");
    fireEvent.change(slider, { target: { value: "5" } });

    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("hides unknown scope strategy when maxConcurrentCoders is 1", () => {
    renderAgentsStep({ maxConcurrentCoders: 1 });

    expect(screen.queryByTestId("unknown-scope-strategy-select")).not.toBeInTheDocument();
  });

  it("shows unknown scope strategy when maxConcurrentCoders > 1", () => {
    renderAgentsStep({ maxConcurrentCoders: 3 });

    expect(screen.getByTestId("unknown-scope-strategy-select")).toBeInTheDocument();
    expect(screen.getByTestId("unknown-scope-strategy-select")).toHaveValue("optimistic");
  });
});
