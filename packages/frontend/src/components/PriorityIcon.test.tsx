import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriorityIcon } from "./PriorityIcon";

describe("PriorityIcon", () => {
  it("renders correct SVG for Critical (0) with shield/pennant and gradient", () => {
    const { container } = render(<PriorityIcon priority={0} />);

    const svg = screen.getByRole("img", { name: "Critical" });
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("viewBox", "0 0 16 16");
    const defs = container.querySelector("defs linearGradient");
    expect(defs).toBeInTheDocument();
    const path = container.querySelector("path[fill]");
    expect(path).toBeTruthy();
    expect(path?.getAttribute("fill")).toMatch(/^url\(#/);
  });

  it("renders correct SVG for High (1) with single upward chevron", () => {
    const { container } = render(<PriorityIcon priority={1} />);

    expect(screen.getByRole("img", { name: "High" })).toBeInTheDocument();
    const path = container.querySelector("path");
    expect(path).toBeTruthy();
    expect(path).toHaveAttribute("fill", "#ff5630");
  });

  it("renders correct SVG for Medium (2) with two horizontal bars", () => {
    const { container } = render(<PriorityIcon priority={2} />);

    expect(screen.getByRole("img", { name: "Medium" })).toBeInTheDocument();
    const path = container.querySelector("path");
    expect(path).toBeTruthy();
    expect(path).toHaveAttribute("fill", "#FFAB00");
  });

  it("renders correct SVG for Low (3) with single downward chevron", () => {
    const { container } = render(<PriorityIcon priority={3} />);

    expect(screen.getByRole("img", { name: "Low" })).toBeInTheDocument();
    const path = container.querySelector("path");
    expect(path).toBeTruthy();
    expect(path).toHaveAttribute("fill", "#0065ff");
  });

  it("renders correct SVG for Lowest (4) with two downward chevrons (duo-tone)", () => {
    const { container } = render(<PriorityIcon priority={4} />);

    expect(screen.getByRole("img", { name: "Lowest" })).toBeInTheDocument();
    const paths = container.querySelectorAll("path");
    expect(paths).toHaveLength(2);
    expect(paths[0]).toHaveAttribute("fill", "#0065ff");
    expect(paths[1]).toHaveAttribute("fill", "#2684ff");
  });

  it("applies sm size classes by default", () => {
    render(<PriorityIcon priority={2} />);

    const svg = screen.getByRole("img", { name: "Medium" });
    expect(svg).toHaveClass("w-4", "h-4");
  });

  it("applies xs size classes", () => {
    render(<PriorityIcon priority={2} size="xs" />);

    const svg = screen.getByRole("img", { name: "Medium" });
    expect(svg).toHaveClass("w-3", "h-3");
  });

  it("applies md size classes", () => {
    render(<PriorityIcon priority={2} size="md" />);

    const svg = screen.getByRole("img", { name: "Medium" });
    expect(svg).toHaveClass("w-5", "h-5");
  });

  it("falls back to Medium icon for out-of-range priority", () => {
    const { container } = render(<PriorityIcon priority={99} />);

    expect(screen.getByRole("img", { name: "Medium" })).toBeInTheDocument();
    const path = container.querySelector("path");
    expect(path).toBeTruthy();
    expect(path).toHaveAttribute("fill", "#FFAB00");
  });

  it("falls back to Medium icon for negative priority", () => {
    render(<PriorityIcon priority={-1} />);

    expect(screen.getByRole("img", { name: "Medium" })).toBeInTheDocument();
  });

  it("has correct aria-label for each priority level", () => {
    const labels = ["Critical", "High", "Medium", "Low", "Lowest"];
    labels.forEach((label, idx) => {
      const { unmount } = render(<PriorityIcon priority={idx} />);
      expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
      unmount();
    });
  });

  it("applies custom className", () => {
    render(<PriorityIcon priority={1} className="ml-2 opacity-50" />);

    const svg = screen.getByRole("img", { name: "High" });
    expect(svg).toHaveClass("ml-2", "opacity-50");
  });

  it("always includes shrink-0 to prevent flex squishing", () => {
    render(<PriorityIcon priority={2} />);

    const svg = screen.getByRole("img", { name: "Medium" });
    expect(svg).toHaveClass("shrink-0");
  });

  it("multiple Critical icons on the same page have unique gradient IDs", () => {
    const { container } = render(
      <>
        <PriorityIcon priority={0} />
        <PriorityIcon priority={0} />
      </>
    );

    const gradientIds = container.querySelectorAll("defs linearGradient[id]");
    expect(gradientIds.length).toBe(2);
    const ids = Array.from(gradientIds).map((el) => el.getAttribute("id"));
    expect(new Set(ids).size).toBe(2);
  });
});
