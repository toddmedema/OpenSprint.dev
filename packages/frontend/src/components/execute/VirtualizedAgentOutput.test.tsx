import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VirtualizedAgentOutput } from "./VirtualizedAgentOutput";

describe("VirtualizedAgentOutput", () => {
  it("renders content with ReactMarkdown in markdown mode", () => {
    const containerRef = { current: null as HTMLDivElement | null };
    render(
      <VirtualizedAgentOutput
        content="**Bold** and `code`"
        mode="markdown"
        containerRef={containerRef}
        data-testid="output"
      />
    );

    const el = screen.getByTestId("output");
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("Bold");
    expect(el).toHaveTextContent("code");
  });

  it("renders content as plain text in stream mode", () => {
    const containerRef = { current: null as HTMLDivElement | null };
    render(
      <VirtualizedAgentOutput
        content="**Bold** and `code`"
        mode="stream"
        containerRef={containerRef}
        data-testid="output"
      />
    );

    const el = screen.getByTestId("output");
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("**Bold** and `code`");
  });

  it("renders empty content as empty string", () => {
    const containerRef = { current: null as HTMLDivElement | null };
    render(
      <VirtualizedAgentOutput
        content=""
        mode="markdown"
        containerRef={containerRef}
        data-testid="output"
      />
    );

    const el = screen.getByTestId("output");
    expect(el).toBeInTheDocument();
  });

  it("applies prose-execute-task class for markdown mode", () => {
    const containerRef = { current: null as HTMLDivElement | null };
    render(
      <VirtualizedAgentOutput
        content="Hello"
        mode="markdown"
        containerRef={containerRef}
        data-testid="output"
      />
    );

    const el = screen.getByTestId("output");
    expect(el).toHaveClass("prose-execute-task");
  });

  it("calls onScroll when user scrolls", () => {
    const containerRef = React.createRef<HTMLDivElement>();
    const onScroll = vi.fn();
    render(
      <VirtualizedAgentOutput
        content="Hello"
        mode="markdown"
        containerRef={containerRef}
        onScroll={onScroll}
        data-testid="output"
      />
    );

    const el = screen.getByTestId("output");
    fireEvent.scroll(el);
    expect(onScroll).toHaveBeenCalled();
  });
});
