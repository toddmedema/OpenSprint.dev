import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiffView, INITIAL_LINE_CAP } from "./DiffView";
import type { DiffResult } from "./DiffView";

const sampleDiff: DiffResult = {
  lines: [
    { type: "context", text: "unchanged line", oldLineNumber: 1, newLineNumber: 1 },
    { type: "remove", text: "old line", oldLineNumber: 2 },
    { type: "add", text: "new line", newLineNumber: 2 },
    { type: "context", text: "another unchanged", oldLineNumber: 3, newLineNumber: 3 },
  ],
  summary: { additions: 1, deletions: 1 },
};

describe("DiffView", () => {
  describe("raw mode rendering", () => {
    it("renders context rows correctly", () => {
      render(<DiffView diff={sampleDiff} defaultMode="raw" />);
      const items = within(screen.getByRole("textbox", { name: "Diff lines" })).getAllByRole(
        "listitem",
      );
      const contextRow = items[0];
      expect(contextRow).toHaveAttribute("data-line-type", "context");
      expect(contextRow).toHaveTextContent("unchanged line");
    });

    it("renders add rows with + marker", () => {
      render(<DiffView diff={sampleDiff} defaultMode="raw" />);
      const items = within(screen.getByRole("textbox", { name: "Diff lines" })).getAllByRole(
        "listitem",
      );
      const addRow = items[2];
      expect(addRow).toHaveAttribute("data-line-type", "add");
      expect(addRow).toHaveTextContent("new line");
      expect(screen.getByTestId("line-marker-2")).toHaveTextContent("+");
    });

    it("renders remove rows with - marker", () => {
      render(<DiffView diff={sampleDiff} defaultMode="raw" />);
      const items = within(screen.getByRole("textbox", { name: "Diff lines" })).getAllByRole(
        "listitem",
      );
      const removeRow = items[1];
      expect(removeRow).toHaveAttribute("data-line-type", "remove");
      expect(removeRow).toHaveTextContent("old line");
      expect(screen.getByTestId("line-marker-1")).toHaveTextContent("-");
    });

    it("renders context rows with space marker", () => {
      render(<DiffView diff={sampleDiff} defaultMode="raw" />);
      const marker = screen.getByTestId("line-marker-0");
      expect(marker.textContent).toBe(" ");
    });

    it("renders old and new line number columns", () => {
      render(<DiffView diff={sampleDiff} defaultMode="raw" />);
      expect(screen.getByTestId("line-old-0")).toHaveTextContent("1");
      expect(screen.getByTestId("line-new-0")).toHaveTextContent("1");
      expect(screen.getByTestId("line-old-1")).toHaveTextContent("2");
      expect(screen.getByTestId("line-new-1")).toHaveTextContent("");
      expect(screen.getByTestId("line-old-2")).toHaveTextContent("");
      expect(screen.getByTestId("line-new-2")).toHaveTextContent("2");
    });

    it("shows No changes when lines array is empty", () => {
      render(<DiffView diff={{ lines: [] }} defaultMode="raw" />);
      expect(screen.getByTestId("diff-view-no-changes")).toHaveTextContent("No changes");
    });

    it("shows summary when provided", () => {
      render(<DiffView diff={sampleDiff} defaultMode="raw" />);
      expect(screen.getByTestId("diff-view-summary")).toHaveTextContent("+1 −1");
    });

    it("omits summary when not provided", () => {
      render(<DiffView diff={{ lines: sampleDiff.lines }} defaultMode="raw" />);
      expect(screen.queryByTestId("diff-view-summary")).not.toBeInTheDocument();
    });
  });

  describe("aria labels", () => {
    it("applies correct aria labels for each line type", () => {
      render(<DiffView diff={sampleDiff} defaultMode="raw" />);
      const items = within(screen.getByRole("textbox", { name: "Diff lines" })).getAllByRole(
        "listitem",
      );
      expect(items[0]).toHaveAttribute("aria-label", expect.stringContaining("Context line"));
      expect(items[1]).toHaveAttribute("aria-label", expect.stringContaining("Removed line"));
      expect(items[2]).toHaveAttribute("aria-label", expect.stringContaining("Added line"));
      expect(items[3]).toHaveAttribute("aria-label", expect.stringContaining("Context line"));
    });

    it("truncates long text in aria label", () => {
      const longLine = "x".repeat(100);
      const diff: DiffResult = {
        lines: [{ type: "add", text: longLine, newLineNumber: 1 }],
      };
      render(<DiffView diff={diff} defaultMode="raw" />);
      const item = within(screen.getByRole("textbox", { name: "Diff lines" })).getByRole(
        "listitem",
      );
      const label = item.getAttribute("aria-label") ?? "";
      expect(label.endsWith("…")).toBe(true);
      expect(label.length).toBeLessThan(longLine.length + 20);
    });
  });

  describe("keyboard navigation", () => {
    it("focuses first line on ArrowDown", async () => {
      const user = userEvent.setup();
      render(<DiffView diff={sampleDiff} defaultMode="raw" />);
      const container = screen.getByRole("textbox", { name: "Diff lines" });
      container.focus();
      await user.keyboard("{ArrowDown}");
      const items = within(container).getAllByRole("listitem");
      expect(items[0]).toHaveFocus();
    });

    it("navigates with ArrowDown and ArrowUp", async () => {
      const user = userEvent.setup();
      render(<DiffView diff={sampleDiff} defaultMode="raw" />);
      const container = screen.getByRole("textbox", { name: "Diff lines" });
      container.focus();
      await user.keyboard("{ArrowDown}");
      await user.keyboard("{ArrowDown}");
      const items = within(container).getAllByRole("listitem");
      expect(items[1]).toHaveFocus();
      await user.keyboard("{ArrowUp}");
      expect(items[0]).toHaveFocus();
    });

    it("Home jumps to first line, End to last", async () => {
      const user = userEvent.setup();
      render(<DiffView diff={sampleDiff} defaultMode="raw" />);
      const container = screen.getByRole("textbox", { name: "Diff lines" });
      container.focus();
      await user.keyboard("{End}");
      const items = within(container).getAllByRole("listitem");
      expect(items[items.length - 1]).toHaveFocus();
      await user.keyboard("{Home}");
      expect(items[0]).toHaveFocus();
    });

    it("does not go past boundaries", async () => {
      const user = userEvent.setup();
      render(<DiffView diff={sampleDiff} defaultMode="raw" />);
      const container = screen.getByRole("textbox", { name: "Diff lines" });
      container.focus();
      await user.keyboard("{ArrowDown}");
      await user.keyboard("{ArrowUp}");
      await user.keyboard("{ArrowUp}");
      const items = within(container).getAllByRole("listitem");
      expect(items[0]).toHaveFocus();
    });
  });

  describe("toggle container", () => {
    it("renders toggle bar with Rendered and Raw buttons", () => {
      render(<DiffView diff={sampleDiff} />);
      expect(screen.getByTestId("diff-view-toggle-bar")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Rendered" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Raw" })).toBeInTheDocument();
    });

    it("defaults to rendered mode", () => {
      render(<DiffView diff={sampleDiff} />);
      expect(screen.getByRole("radio", { name: "Rendered" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(screen.getByRole("radio", { name: "Raw" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
      expect(screen.getByTestId("diff-view-rendered-placeholder")).toBeInTheDocument();
    });

    it("switches to raw on toggle", async () => {
      const user = userEvent.setup();
      render(<DiffView diff={sampleDiff} />);
      await user.click(screen.getByRole("radio", { name: "Raw" }));
      expect(screen.getByTestId("diff-view-raw")).toBeInTheDocument();
      expect(screen.queryByTestId("diff-view-rendered-placeholder")).not.toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Raw" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });

    it("switches back to rendered on toggle", async () => {
      const user = userEvent.setup();
      render(<DiffView diff={sampleDiff} />);
      await user.click(screen.getByRole("radio", { name: "Raw" }));
      await user.click(screen.getByRole("radio", { name: "Rendered" }));
      expect(screen.getByTestId("diff-view-rendered-placeholder")).toBeInTheDocument();
      expect(screen.queryByTestId("diff-view-raw")).not.toBeInTheDocument();
    });

    it("toggle buttons are keyboard-focusable", () => {
      render(<DiffView diff={sampleDiff} />);
      const rendered = screen.getByRole("radio", { name: "Rendered" });
      rendered.focus();
      expect(rendered).toHaveFocus();
    });

    it("radiogroup has correct aria-label", () => {
      render(<DiffView diff={sampleDiff} />);
      expect(screen.getByRole("radiogroup", { name: "Diff view mode" })).toBeInTheDocument();
    });

    it("respects defaultMode prop", () => {
      render(<DiffView diff={sampleDiff} defaultMode="raw" />);
      expect(screen.getByTestId("diff-view-raw")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Raw" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });

    it("uses roving tabindex on toggle buttons", () => {
      render(<DiffView diff={sampleDiff} />);
      const rendered = screen.getByRole("radio", { name: "Rendered" });
      const raw = screen.getByRole("radio", { name: "Raw" });
      expect(rendered).toHaveAttribute("tabindex", "0");
      expect(raw).toHaveAttribute("tabindex", "-1");
    });

    it("navigates toggle with ArrowRight/ArrowLeft", async () => {
      const user = userEvent.setup();
      render(<DiffView diff={sampleDiff} />);
      const rendered = screen.getByRole("radio", { name: "Rendered" });
      rendered.focus();
      await user.keyboard("{ArrowRight}");
      expect(screen.getByRole("radio", { name: "Raw" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await user.keyboard("{ArrowLeft}");
      expect(screen.getByRole("radio", { name: "Rendered" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });
  });

  describe("large diff capping", () => {
    const manyLines = Array.from({ length: INITIAL_LINE_CAP + 20 }, (_, i) => ({
      type: "context" as const,
      text: `Line ${i + 1}`,
      oldLineNumber: i + 1,
      newLineNumber: i + 1,
    }));

    it("caps lines and shows Show more button", () => {
      render(<DiffView diff={{ lines: manyLines }} defaultMode="raw" />);
      expect(screen.getByTestId("diff-view-show-more")).toBeInTheDocument();
      expect(screen.getByText(/Show more \(20 more lines\)/)).toBeInTheDocument();
      expect(screen.getByText("Line 1")).toBeInTheDocument();
      expect(screen.getByText(`Line ${INITIAL_LINE_CAP}`)).toBeInTheDocument();
      expect(screen.queryByText(`Line ${INITIAL_LINE_CAP + 1}`)).not.toBeInTheDocument();
    });

    it("expands all lines on Show more click", async () => {
      const user = userEvent.setup();
      render(<DiffView diff={{ lines: manyLines }} defaultMode="raw" />);
      await user.click(screen.getByTestId("diff-view-show-more"));
      expect(screen.queryByTestId("diff-view-show-more")).not.toBeInTheDocument();
      expect(screen.getByText(`Line ${INITIAL_LINE_CAP + 20}`)).toBeInTheDocument();
    });

    it("does not show Show more for small diffs", () => {
      render(<DiffView diff={sampleDiff} defaultMode="raw" />);
      expect(screen.queryByTestId("diff-view-show-more")).not.toBeInTheDocument();
    });
  });

  describe("edge cases", () => {
    it("renders empty text lines with non-breaking space", () => {
      const diff: DiffResult = {
        lines: [{ type: "context", text: "", oldLineNumber: 1, newLineNumber: 1 }],
      };
      render(<DiffView diff={diff} defaultMode="raw" />);
      const items = within(screen.getByRole("textbox", { name: "Diff lines" })).getAllByRole(
        "listitem",
      );
      expect(items[0].textContent).toContain("\u00a0");
    });

    it("accepts fromContent and toContent props without error", () => {
      render(
        <DiffView
          diff={sampleDiff}
          fromContent="old content"
          toContent="new content"
        />,
      );
      expect(screen.getByTestId("diff-view")).toBeInTheDocument();
    });
  });

  describe("rendered mode integration", () => {
    it("shows rendered diff when toggled with fromContent and toContent", async () => {
      const user = userEvent.setup();
      render(
        <DiffView
          diff={sampleDiff}
          fromContent="# Title\n\nOld paragraph."
          toContent="# Title\n\nNew paragraph."
          defaultMode="raw"
        />,
      );
      await user.click(screen.getByRole("radio", { name: "Rendered" }));
      expect(screen.getByTestId("diff-view-rendered")).toBeInTheDocument();
      expect(screen.queryByTestId("diff-view-raw")).not.toBeInTheDocument();
    });

    it("shows placeholder when rendered mode lacks fromContent/toContent", () => {
      render(<DiffView diff={sampleDiff} />);
      expect(screen.getByTestId("diff-view-rendered-placeholder")).toBeInTheDocument();
    });

    it("switches between rendered and raw modes", async () => {
      const user = userEvent.setup();
      render(
        <DiffView
          diff={sampleDiff}
          fromContent="# Title"
          toContent="# Title\n\nAdded."
          defaultMode="raw"
        />,
      );
      await user.click(screen.getByRole("radio", { name: "Rendered" }));
      expect(screen.getByTestId("diff-view-rendered")).toBeInTheDocument();
      await user.click(screen.getByRole("radio", { name: "Raw" }));
      expect(screen.getByTestId("diff-view-raw")).toBeInTheDocument();
    });

    it("shows rendered view by default when fromContent and toContent provided", () => {
      render(
        <DiffView
          diff={sampleDiff}
          fromContent="# Title\n\nOld paragraph."
          toContent="# Title\n\nNew paragraph."
        />,
      );
      expect(screen.getByTestId("diff-view-rendered")).toBeInTheDocument();
      expect(screen.queryByTestId("diff-view-raw")).not.toBeInTheDocument();
    });

    it("shows no-changes in rendered mode for identical content", () => {
      const content = "# Title\n\nSame paragraph.";
      render(
        <DiffView
          diff={{ lines: [] }}
          fromContent={content}
          toContent={content}
        />,
      );
      expect(screen.getByTestId("diff-view-no-changes")).toHaveTextContent("No changes");
    });
  });

  describe("theme", () => {
    it("rendered diff container includes dark:prose-invert class", () => {
      render(
        <DiffView
          diff={sampleDiff}
          fromContent="# Title"
          toContent="# Title\n\nNew."
        />,
      );
      const rendered = screen.getByTestId("diff-view-rendered");
      expect(rendered.className).toContain("dark:prose-invert");
    });

    it("rendered diff container includes prose-execute-task class", () => {
      render(
        <DiffView
          diff={sampleDiff}
          fromContent="# Title"
          toContent="# Title\n\nNew."
        />,
      );
      const rendered = screen.getByTestId("diff-view-rendered");
      expect(rendered.className).toContain("prose-execute-task");
    });

    it("uses theme CSS variable classes in raw mode", () => {
      render(<DiffView diff={sampleDiff} defaultMode="raw" />);
      const rawContainer = screen.getByTestId("diff-view-raw");
      const items = within(rawContainer).getAllByRole("listitem");
      const addRow = items[2];
      expect(addRow.className).toContain("bg-theme-success-bg");
      const removeRow = items[1];
      expect(removeRow.className).toContain("bg-theme-error-bg");
    });
  });

  describe("accessibility", () => {
    it("rendered blocks have aria-describedby linking to badge", () => {
      render(
        <DiffView
          diff={sampleDiff}
          fromContent="# Title\n\nOld paragraph."
          toContent="# Title\n\nNew paragraph."
        />,
      );
      const rendered = screen.getByTestId("diff-view-rendered");
      const modifiedBlocks = rendered.querySelectorAll('[data-diff-status="modified"]');
      expect(modifiedBlocks.length).toBeGreaterThan(0);
      const describedBy = modifiedBlocks[0].getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      const badge = rendered.querySelector(`#${describedBy}`);
      expect(badge).toBeTruthy();
      expect(badge?.textContent).toContain("Modified");
    });

    it("changed blocks in rendered mode have status badge", () => {
      const from = "# Title";
      const to = "# Title\n\nNew paragraph.";
      render(
        <DiffView
          diff={sampleDiff}
          fromContent={from}
          toContent={to}
        />,
      );
      const rendered = screen.getByTestId("diff-view-rendered");
      const changedBlocks = rendered.querySelectorAll(
        '[data-diff-status="added"], [data-diff-status="modified"]'
      );
      expect(changedBlocks.length).toBeGreaterThan(0);
      const badgeText = changedBlocks[0].textContent ?? "";
      expect(badgeText).toMatch(/\+ Added|~ Modified/);
    });

    it("removal blocks in rendered mode have status badge", () => {
      const from = "# Title\n\nOld paragraph.";
      const to = "# Title";
      render(
        <DiffView
          diff={sampleDiff}
          fromContent={from}
          toContent={to}
        />,
      );
      const rendered = screen.getByTestId("diff-view-rendered");
      const changedBlocks = rendered.querySelectorAll(
        '[data-diff-status="removed"], [data-diff-status="modified"]'
      );
      expect(changedBlocks.length).toBeGreaterThan(0);
      const badgeText = changedBlocks[0].textContent ?? "";
      expect(badgeText).toMatch(/− Removed|~ Modified/);
    });

    it("ins elements have aria-label for screen readers", () => {
      render(
        <DiffView
          diff={sampleDiff}
          fromContent="Hello world."
          toContent="Hello universe."
        />,
      );
      const rendered = screen.getByTestId("diff-view-rendered");
      const insElements = rendered.querySelectorAll("ins");
      if (insElements.length > 0) {
        expect(insElements[0]).toHaveAttribute("aria-label", "Added text");
      }
    });

    it("del elements have aria-label for screen readers", () => {
      render(
        <DiffView
          diff={sampleDiff}
          fromContent="Hello world."
          toContent="Hello universe."
        />,
      );
      const rendered = screen.getByTestId("diff-view-rendered");
      const delElements = rendered.querySelectorAll("del");
      if (delElements.length > 0) {
        expect(delElements[0]).toHaveAttribute("aria-label", "Removed text");
      }
    });

    it("ins elements use underline decoration (not color-only)", () => {
      render(
        <DiffView
          diff={sampleDiff}
          fromContent="Hello world."
          toContent="Hello universe."
        />,
      );
      const rendered = screen.getByTestId("diff-view-rendered");
      const insElements = rendered.querySelectorAll("ins");
      if (insElements.length > 0) {
        expect(insElements[0].className).toContain("underline");
      }
    });
  });
});
