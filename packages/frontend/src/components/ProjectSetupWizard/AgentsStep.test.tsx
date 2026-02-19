import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentsStep } from "./AgentsStep";

vi.mock("../../api/client", () => ({
  api: {
    models: {
      list: vi.fn().mockResolvedValue([]),
    },
  },
}));

const defaultPlanningAgent = {
  type: "claude" as const,
  model: "claude-3-5-sonnet",
  cliCommand: "",
};
const defaultCodingAgent = {
  type: "claude" as const,
  model: "claude-3-5-sonnet",
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

  it("hides API key banner, inputs, and status when both keys are configured", () => {
    renderAgentsStep({
      envKeys: { anthropic: true, cursor: true },
    });

    expect(screen.queryByText(/API keys required/)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("sk-ant-...")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("key_...")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        /Both API keys configured|Claude API key configured|Cursor API key configured/
      )
    ).not.toBeInTheDocument();
  });

  it("shows API key banner and inputs when anthropic key is missing", () => {
    renderAgentsStep({
      envKeys: { anthropic: false, cursor: true },
    });

    expect(screen.getByText(/API keys required/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("sk-ant-...")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("key_...")).not.toBeInTheDocument();
  });

  it("shows API key banner and inputs when cursor key is missing", () => {
    renderAgentsStep({
      envKeys: { anthropic: true, cursor: false },
    });

    expect(screen.getByText(/API keys required/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("sk-ant-...")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("key_...")).toBeInTheDocument();
  });

  it("shows API key banner and both inputs when neither key is configured", () => {
    renderAgentsStep({
      envKeys: { anthropic: false, cursor: false },
    });

    expect(screen.getByText(/API keys required/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("sk-ant-...")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("key_...")).toBeInTheDocument();
  });

  it("does not show API key section when envKeys is null", () => {
    renderAgentsStep({ envKeys: null });

    expect(screen.queryByText(/API keys required/)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("sk-ant-...")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("key_...")).not.toBeInTheDocument();
  });
});
