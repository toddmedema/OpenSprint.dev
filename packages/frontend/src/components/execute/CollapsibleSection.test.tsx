import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollapsibleSection } from "./CollapsibleSection";

describe("CollapsibleSection", () => {
  it("renders header with title and collapse/expand chevron", () => {
    render(
      <CollapsibleSection
        title="Test Section"
        expanded={true}
        onToggle={() => {}}
        expandAriaLabel="Expand Test Section"
        collapseAriaLabel="Collapse Test Section"
        contentId="test-content"
        headerId="test-header"
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    const button = screen.getByRole("button", { name: /collapse test section/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Test Section")).toBeInTheDocument();
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("hides content when collapsed", () => {
    render(
      <CollapsibleSection
        title="Test Section"
        expanded={false}
        onToggle={() => {}}
        expandAriaLabel="Expand Test Section"
        collapseAriaLabel="Collapse Test Section"
        contentId="test-content"
        headerId="test-header"
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    expect(screen.getByRole("button", { name: /expand test section/i })).toBeInTheDocument();
    expect(screen.queryByText("Content")).not.toBeInTheDocument();
  });

  it("calls onToggle when header is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <CollapsibleSection
        title="Test Section"
        expanded={true}
        onToggle={onToggle}
        expandAriaLabel="Expand Test Section"
        collapseAriaLabel="Collapse Test Section"
        contentId="test-content"
        headerId="test-header"
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    await user.click(screen.getByRole("button", { name: /collapse test section/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("uses standardized header classes with balanced padding and gap", () => {
    const { container } = render(
      <CollapsibleSection
        title="Description"
        expanded={true}
        onToggle={() => {}}
        expandAriaLabel="Expand"
        collapseAriaLabel="Collapse"
        contentId="desc-content"
        headerId="desc-header"
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    const header = container.querySelector("#desc-header");
    const content = container.querySelector("#desc-content");
    expect(header).toHaveClass(
      "w-full",
      "flex",
      "items-center",
      "justify-between",
      "gap-3",
      "px-4",
      "py-2",
      "text-left",
      "hover:bg-theme-border-subtle/50",
      "transition-colors"
    );
    expect(content).toHaveClass("p-4", "pt-0");
    const h4 = header?.querySelector("h4");
    expect(h4).toHaveClass(
      "text-xs",
      "font-medium",
      "text-theme-muted",
      "uppercase",
      "tracking-wide"
    );
  });

  it("renders chevron SVG that rotates when expanded", () => {
    const { container, rerender } = render(
      <CollapsibleSection
        title="Section"
        expanded={false}
        onToggle={() => {}}
        expandAriaLabel="Expand"
        collapseAriaLabel="Collapse"
        contentId="c"
        headerId="h"
      >
        <div />
      </CollapsibleSection>
    );

    const svg = container.querySelector("#h svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveClass("w-4", "h-4", "shrink-0", "text-theme-muted");
    expect(svg).not.toHaveClass("rotate-90");

    rerender(
      <CollapsibleSection
        title="Section"
        expanded={true}
        onToggle={() => {}}
        expandAriaLabel="Expand"
        collapseAriaLabel="Collapse"
        contentId="c"
        headerId="h"
      >
        <div />
      </CollapsibleSection>
    );

    const svgExpanded = container.querySelector("#h svg");
    expect(svgExpanded).toHaveClass("rotate-90");
  });

  it("uses contentClassName when provided for compact sections", () => {
    const { container } = render(
      <CollapsibleSection
        title="Description"
        expanded={true}
        onToggle={() => {}}
        expandAriaLabel="Expand"
        collapseAriaLabel="Collapse"
        contentId="desc-content"
        headerId="desc-header"
        contentClassName="px-3 pt-0 pb-2"
      >
        <div>Content</div>
      </CollapsibleSection>
    );

    const content = container.querySelector("#desc-content");
    expect(content).toHaveClass("px-3", "pt-0", "pb-2");
    expect(content).not.toHaveClass("p-4");
  });
});
