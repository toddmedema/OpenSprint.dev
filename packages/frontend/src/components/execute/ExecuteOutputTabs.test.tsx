import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExecuteOutputTabs } from "./ExecuteOutputTabs";

describe("ExecuteOutputTabs", () => {
  it("renders with Output and Chat tabs", () => {
    render(
      <ExecuteOutputTabs
        outputContent={<div>Agent output stream</div>}
        chatContent={<div>Chat panel</div>}
      />
    );

    expect(screen.getByTestId("execute-output-tabs")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Output" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Chat" })).toBeInTheDocument();
  });

  it("shows Output tab selected by default", () => {
    render(
      <ExecuteOutputTabs
        outputContent={<div>Agent output stream</div>}
        chatContent={<div>Chat panel</div>}
      />
    );

    const outputTab = screen.getByRole("tab", { name: "Output" });
    const chatTab = screen.getByRole("tab", { name: "Chat" });
    expect(outputTab).toHaveAttribute("aria-selected", "true");
    expect(chatTab).toHaveAttribute("aria-selected", "false");
  });

  it("displays output content when Output tab is selected", () => {
    render(
      <ExecuteOutputTabs
        outputContent={<div>Agent output stream</div>}
        chatContent={<div>Chat panel</div>}
      />
    );

    expect(screen.getByText("Agent output stream")).toBeInTheDocument();
    expect(screen.queryByText("Chat panel")).not.toBeInTheDocument();
  });

  it("switches to Chat tab when clicked", async () => {
    const user = userEvent.setup();
    render(
      <ExecuteOutputTabs
        outputContent={<div>Agent output stream</div>}
        chatContent={<div>Chat panel</div>}
      />
    );

    await user.click(screen.getByRole("tab", { name: "Chat" }));

    const chatTab = screen.getByRole("tab", { name: "Chat" });
    const outputTab = screen.getByRole("tab", { name: "Output" });
    expect(chatTab).toHaveAttribute("aria-selected", "true");
    expect(outputTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("Chat panel")).toBeInTheDocument();
    expect(screen.queryByText("Agent output stream")).not.toBeInTheDocument();
  });

  it("switches back to Output tab after switching to Chat", async () => {
    const user = userEvent.setup();
    render(
      <ExecuteOutputTabs
        outputContent={<div>Agent output stream</div>}
        chatContent={<div>Chat panel</div>}
      />
    );

    await user.click(screen.getByRole("tab", { name: "Chat" }));
    await user.click(screen.getByRole("tab", { name: "Output" }));

    expect(screen.getByRole("tab", { name: "Output" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Agent output stream")).toBeInTheDocument();
    expect(screen.queryByText("Chat panel")).not.toBeInTheDocument();
  });

  it("has proper ARIA attributes for accessibility", () => {
    render(
      <ExecuteOutputTabs
        outputContent={<div>Agent output stream</div>}
        chatContent={<div>Chat panel</div>}
      />
    );

    const tablist = screen.getByRole("tablist");
    expect(tablist).toHaveAttribute("aria-label", "Agent output tabs");

    const outputTab = screen.getByRole("tab", { name: "Output" });
    expect(outputTab).toHaveAttribute("aria-controls", "execute-output-tabpanel");
    expect(outputTab).toHaveAttribute("id", "execute-output-tab");

    const chatTab = screen.getByRole("tab", { name: "Chat" });
    expect(chatTab).toHaveAttribute("aria-controls", "execute-chat-tabpanel");
    expect(chatTab).toHaveAttribute("id", "execute-chat-tab");
  });

  it("renders the correct tabpanel with matching id and aria-labelledby", () => {
    render(
      <ExecuteOutputTabs
        outputContent={<div>Agent output stream</div>}
        chatContent={<div>Chat panel</div>}
      />
    );

    const tabpanel = screen.getByRole("tabpanel");
    expect(tabpanel).toHaveAttribute("id", "execute-output-tabpanel");
    expect(tabpanel).toHaveAttribute("aria-labelledby", "execute-output-tab");
  });

  it("updates tabpanel id and aria-labelledby when switching to Chat", async () => {
    const user = userEvent.setup();
    render(
      <ExecuteOutputTabs
        outputContent={<div>Agent output stream</div>}
        chatContent={<div>Chat panel</div>}
      />
    );

    await user.click(screen.getByRole("tab", { name: "Chat" }));

    const tabpanel = screen.getByRole("tabpanel");
    expect(tabpanel).toHaveAttribute("id", "execute-chat-tabpanel");
    expect(tabpanel).toHaveAttribute("aria-labelledby", "execute-chat-tab");
  });

  it("applies active styling to selected tab", () => {
    render(
      <ExecuteOutputTabs
        outputContent={<div>Agent output stream</div>}
        chatContent={<div>Chat panel</div>}
      />
    );

    const outputTab = screen.getByRole("tab", { name: "Output" });
    const chatTab = screen.getByRole("tab", { name: "Chat" });

    expect(outputTab).toHaveClass("text-brand-600");
    expect(outputTab).toHaveClass("border-b-2");
    expect(chatTab).toHaveClass("text-theme-muted");
    expect(chatTab).not.toHaveClass("border-b-2");
  });

  it("calls onTabChange when tab is switched to Chat", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(
      <ExecuteOutputTabs
        outputContent={<div>Agent output stream</div>}
        chatContent={<div>Chat panel</div>}
        onTabChange={onTabChange}
      />
    );

    await user.click(screen.getByRole("tab", { name: "Chat" }));
    expect(onTabChange).toHaveBeenCalledWith("chat");
  });

  it("calls onTabChange when tab is switched back to Output", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(
      <ExecuteOutputTabs
        outputContent={<div>Agent output stream</div>}
        chatContent={<div>Chat panel</div>}
        onTabChange={onTabChange}
      />
    );

    await user.click(screen.getByRole("tab", { name: "Chat" }));
    await user.click(screen.getByRole("tab", { name: "Output" }));
    expect(onTabChange).toHaveBeenCalledTimes(2);
    expect(onTabChange).toHaveBeenNthCalledWith(1, "chat");
    expect(onTabChange).toHaveBeenNthCalledWith(2, "output");
  });

  it("does not throw when onTabChange is not provided", async () => {
    const user = userEvent.setup();
    render(
      <ExecuteOutputTabs
        outputContent={<div>Agent output stream</div>}
        chatContent={<div>Chat panel</div>}
      />
    );

    await expect(user.click(screen.getByRole("tab", { name: "Chat" }))).resolves.not.toThrow();
  });
});
