import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RenderedDiffView, INITIAL_BLOCK_CAP } from "./RenderedDiffView";

describe("RenderedDiffView", () => {
  describe("pure additions", () => {
    it("renders added block with green styling", () => {
      const from = "# Title";
      const to = "# Title\n\nNew paragraph.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const addedBlocks = rendered.querySelectorAll('[data-diff-status="added"]');
      expect(addedBlocks.length).toBeGreaterThan(0);
      expect(addedBlocks[0].textContent).toContain("New paragraph");
      expect(addedBlocks[0]).toHaveAttribute("aria-label", "Added block");
    });

    it("added blocks have status badge for non-color identification", () => {
      const from = "# Title";
      const to = "# Title\n\nNew paragraph.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const addedBlocks = rendered.querySelectorAll('[data-diff-status="added"]');
      expect(addedBlocks[0].textContent).toContain("+ Added");
    });

    it("added blocks have aria-describedby", () => {
      const from = "# Title";
      const to = "# Title\n\nNew paragraph.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const addedBlocks = rendered.querySelectorAll('[data-diff-status="added"]');
      expect(addedBlocks[0]).toHaveAttribute("aria-describedby");
      const descId = addedBlocks[0].getAttribute("aria-describedby")!;
      const badge = rendered.querySelector(`#${descId}`);
      expect(badge).toBeTruthy();
    });
  });

  describe("pure removals", () => {
    it("renders removed block with red styling and strikethrough", () => {
      const from = "# Title\n\nOld paragraph.";
      const to = "# Title";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const removedBlocks = rendered.querySelectorAll('[data-diff-status="removed"]');
      expect(removedBlocks.length).toBeGreaterThan(0);
      expect(removedBlocks[0].textContent).toContain("Old paragraph");
      expect(removedBlocks[0]).toHaveAttribute("aria-label", "Removed block");
      expect(removedBlocks[0].className).toContain("line-through");
    });

    it("removed blocks have status badge", () => {
      const from = "# Title\n\nOld paragraph.";
      const to = "# Title";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const removedBlocks = rendered.querySelectorAll('[data-diff-status="removed"]');
      expect(removedBlocks[0].textContent).toContain("− Removed");
    });
  });

  describe("word-level changes in paragraph", () => {
    it("renders modified block with word-level ins/del elements", () => {
      const from = "The quick brown fox.";
      const to = "The slow brown fox.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const modifiedBlocks = rendered.querySelectorAll('[data-diff-status="modified"]');
      expect(modifiedBlocks.length).toBe(1);

      const ins = modifiedBlocks[0].querySelectorAll("ins");
      const del = modifiedBlocks[0].querySelectorAll("del");
      expect(ins.length).toBeGreaterThan(0);
      expect(del.length).toBeGreaterThan(0);
    });

    it("marks added words with data-diff-word=added", () => {
      const from = "Hello world.";
      const to = "Hello universe.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const addedWords = rendered.querySelectorAll('[data-diff-word="added"]');
      expect(addedWords.length).toBeGreaterThan(0);
      const addedText = Array.from(addedWords).map((el) => el.textContent).join("");
      expect(addedText).toContain("universe");
    });

    it("marks removed words with data-diff-word=removed", () => {
      const from = "Hello world.";
      const to = "Hello universe.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const removedWords = rendered.querySelectorAll('[data-diff-word="removed"]');
      expect(removedWords.length).toBeGreaterThan(0);
      const removedText = Array.from(removedWords).map((el) => el.textContent).join("");
      expect(removedText).toContain("world");
    });

    it("ins elements have aria-label", () => {
      const from = "Hello world.";
      const to = "Hello universe.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const insElements = rendered.querySelectorAll("ins");
      expect(insElements.length).toBeGreaterThan(0);
      expect(insElements[0]).toHaveAttribute("aria-label", "Added text");
    });

    it("del elements have aria-label", () => {
      const from = "Hello world.";
      const to = "Hello universe.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const delElements = rendered.querySelectorAll("del");
      expect(delElements.length).toBeGreaterThan(0);
      expect(delElements[0]).toHaveAttribute("aria-label", "Removed text");
    });

    it("ins elements use underline (not color-only)", () => {
      const from = "Hello world.";
      const to = "Hello universe.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const insElements = rendered.querySelectorAll("ins");
      expect(insElements.length).toBeGreaterThan(0);
      expect(insElements[0].className).toContain("underline");
    });

    it("del elements use line-through", () => {
      const from = "Hello world.";
      const to = "Hello universe.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const delElements = rendered.querySelectorAll("del");
      expect(delElements.length).toBeGreaterThan(0);
      expect(delElements[0].className).toContain("line-through");
    });
  });

  describe("code block diff", () => {
    it("renders added code block", () => {
      const from = "# Intro";
      const to = "# Intro\n\n```js\nconsole.log('hi');\n```";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const addedBlocks = rendered.querySelectorAll('[data-diff-status="added"]');
      expect(addedBlocks.length).toBe(1);
    });

    it("renders removed code block", () => {
      const from = "# Intro\n\n```js\nconsole.log('hi');\n```";
      const to = "# Intro";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const removedBlocks = rendered.querySelectorAll('[data-diff-status="removed"]');
      expect(removedBlocks.length).toBe(1);
    });
  });

  describe("list diff", () => {
    it("renders added list", () => {
      const from = "# Title";
      const to = "# Title\n\n- item one\n- item two";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const addedBlocks = rendered.querySelectorAll('[data-diff-status="added"]');
      expect(addedBlocks.length).toBe(1);
      expect(addedBlocks[0].textContent).toContain("item one");
    });

    it("renders modified list with word-level diff", () => {
      const from = "- alpha\n- beta";
      const to = "- alpha\n- gamma";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const modifiedBlocks = rendered.querySelectorAll('[data-diff-status="modified"]');
      expect(modifiedBlocks.length).toBe(1);
      const ins = modifiedBlocks[0].querySelectorAll("ins");
      expect(ins.length).toBeGreaterThan(0);
    });
  });

  describe("no changes", () => {
    it("renders no-changes message for empty content", () => {
      render(<RenderedDiffView fromContent="" toContent="" />);
      expect(screen.getByTestId("diff-view-no-changes")).toBeInTheDocument();
    });

    it("renders no-changes message for identical non-empty content", () => {
      const content = "# Title\n\nParagraph.";
      render(<RenderedDiffView fromContent={content} toContent={content} />);
      expect(screen.getByTestId("diff-view-no-changes")).toHaveTextContent("No changes");
      expect(screen.queryByTestId("diff-view-rendered")).not.toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("modified blocks have group role and aria-label", () => {
      const from = "The quick brown fox jumps over the lazy dog.";
      const to = "The slow brown fox leaps over the lazy dog.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const modifiedBlocks = rendered.querySelectorAll('[data-diff-status="modified"]');
      expect(modifiedBlocks.length).toBeGreaterThan(0);
      expect(modifiedBlocks[0]).toHaveAttribute("role", "group");
      expect(modifiedBlocks[0]).toHaveAttribute("aria-label", "Modified block");
    });

    it("modified blocks have aria-describedby linking to badge", () => {
      const from = "The quick brown fox jumps over the lazy dog.";
      const to = "The slow brown fox leaps over the lazy dog.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const modifiedBlocks = rendered.querySelectorAll('[data-diff-status="modified"]');
      expect(modifiedBlocks[0]).toHaveAttribute("aria-describedby");
      const descId = modifiedBlocks[0].getAttribute("aria-describedby")!;
      const badge = rendered.querySelector(`#${descId}`);
      expect(badge).toBeTruthy();
      expect(badge?.textContent).toContain("~ Modified");
    });

    it("added blocks use role=group and aria-label", () => {
      const from = "# Title";
      const to = "# Title\n\nNew paragraph.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const addedBlocks = rendered.querySelectorAll('[data-diff-status="added"]');
      expect(addedBlocks[0]).toHaveAttribute("role", "group");
      expect(addedBlocks[0]).toHaveAttribute("aria-label", "Added block");
    });

    it("unchanged blocks have group role and aria-label when there are also changed blocks", () => {
      const from = "# Title\n\nKeep this.";
      const to = "# Title\n\nKeep this.\n\nNew paragraph.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const unchanged = rendered.querySelectorAll('[data-diff-status="unchanged"]');
      expect(unchanged.length).toBeGreaterThan(0);
      expect(unchanged[0]).toHaveAttribute("role", "group");
      expect(unchanged[0]).toHaveAttribute("aria-label", "Unchanged block");
    });
  });

  describe("theme", () => {
    it("rendered container includes dark:prose-invert for dark mode", () => {
      const from = "# Old heading";
      const to = "# Old heading\n\nAdded line.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      expect(rendered.className).toContain("dark:prose-invert");
    });

    it("rendered container includes prose-execute-task for theme variables", () => {
      const from = "# Old heading";
      const to = "# Old heading\n\nAdded line.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      expect(rendered.className).toContain("prose-execute-task");
    });

    it("changed blocks use theme CSS variable classes for success styling", () => {
      const from = "# Title";
      const to = "# Title\n\nNew paragraph.";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const changedBlocks = rendered.querySelectorAll(
        '[data-diff-status="added"], [data-diff-status="modified"]'
      );
      expect(changedBlocks.length).toBeGreaterThan(0);
      const block = changedBlocks[0];
      expect(block.className).toMatch(/border-theme-(success|warning)-border/);
    });

    it("removed blocks use theme CSS variable classes for error styling", () => {
      const from = "# Title\n\nOld paragraph.";
      const to = "# Title";
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const rendered = screen.getByTestId("diff-view-rendered");
      const changedBlocks = rendered.querySelectorAll(
        '[data-diff-status="removed"], [data-diff-status="modified"]'
      );
      expect(changedBlocks.length).toBeGreaterThan(0);
      const block = changedBlocks[0];
      expect(block.className).toMatch(/border-theme-(error|warning)-border/);
    });
  });

  describe("onParseError callback", () => {
    it("does not call onParseError for valid markdown", () => {
      const onParseError = vi.fn();
      render(
        <RenderedDiffView
          fromContent="# Title"
          toContent="# Title\n\nNew."
          onParseError={onParseError}
        />,
      );
      expect(onParseError).not.toHaveBeenCalled();
    });
  });

  describe("block cap (show first N blocks + expand)", () => {
    function buildLargeContent(blockCount: number): string {
      const lines: string[] = [];
      for (let i = 0; i < blockCount; i++) {
        lines.push(`## Section ${i}`);
        lines.push("");
        lines.push(`Content for section ${i}.`);
        lines.push("");
      }
      return lines.join("\n");
    }

    it("caps blocks and shows Show more button for large diffs", () => {
      const from = "# Start";
      const to = "# Start\n\n" + buildLargeContent(INITIAL_BLOCK_CAP + 10);
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      expect(screen.getByTestId("diff-view-rendered-show-more")).toBeInTheDocument();
      expect(screen.getByText(/Show more/)).toBeInTheDocument();
    });

    it("expands all blocks on Show more click", async () => {
      const user = userEvent.setup();
      const from = "# Start";
      const to = "# Start\n\n" + buildLargeContent(INITIAL_BLOCK_CAP + 10);
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      await user.click(screen.getByTestId("diff-view-rendered-show-more"));
      expect(screen.queryByTestId("diff-view-rendered-show-more")).not.toBeInTheDocument();
    });

    it("does not show Show more for small diffs", () => {
      render(
        <RenderedDiffView
          fromContent="# Title"
          toContent="# Title\n\nNew paragraph."
        />,
      );
      expect(screen.queryByTestId("diff-view-rendered-show-more")).not.toBeInTheDocument();
    });
  });

  describe("large fixture performance", () => {
    it("renders ~300 line markdown diff within reasonable time", () => {
      const lines: string[] = [];
      for (let i = 0; i < 50; i++) {
        lines.push(`## Section ${i}`);
        lines.push("");
        lines.push(`Content for section ${i}.`);
        lines.push("");
        lines.push(`- item ${i}a`);
        lines.push(`- item ${i}b`);
        lines.push("");
      }
      const from = lines.join("\n");
      const toLines = [...lines];
      toLines[2] = "Content for section 0, now modified.";
      toLines.push("## Extra Section\n\nAdded at end.");
      const to = toLines.join("\n");

      const start = performance.now();
      render(<RenderedDiffView fromContent={from} toContent={to} />);
      const elapsed = performance.now() - start;

      expect(screen.getByTestId("diff-view-rendered")).toBeInTheDocument();
      expect(elapsed).toBeLessThan(5000);
    });
  });
});
