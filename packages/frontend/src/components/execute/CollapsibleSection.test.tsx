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

  it("uses same element structure and classes as Live Output and Source Feedback", () => {
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
      "p-4",
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
});
