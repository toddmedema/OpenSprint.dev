// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanRefineWithAISection } from "./PlanRefineWithAISection";

describe("PlanRefineWithAISection", () => {
  it("renders user and assistant messages", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <PlanRefineWithAISection
        expanded
        onToggle={() => {}}
        messages={[
          { role: "user", content: "Hi", timestamp: "t1" },
          { role: "assistant", content: "Hello", timestamp: "t2" },
        ]}
        chatSending={false}
        messagesEndRef={ref}
      />
    );
    expect(screen.getByTestId("plan-chat-message-user")).toHaveTextContent("Hi");
    expect(screen.getByTestId("plan-chat-message-assistant")).toHaveTextContent("Hello");
  });

  it("shows plan update label for assistant [PLAN_UPDATE] content", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <PlanRefineWithAISection
        expanded
        onToggle={() => {}}
        messages={[
          {
            role: "assistant",
            content: "[PLAN_UPDATE]\n# Title\n[/PLAN_UPDATE]",
            timestamp: "t1",
          },
        ]}
        chatSending={false}
        messagesEndRef={ref}
      />
    );
    expect(screen.getByTestId("plan-chat-message-assistant")).toHaveTextContent("Plan updated");
  });
});
