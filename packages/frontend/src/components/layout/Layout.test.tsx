import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Layout } from "./Layout";

describe("Layout", () => {
  it("renders children in main", () => {
    render(
      <Layout>
        <span data-testid="child">Content</span>
      </Layout>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("has main with flex flex-col min-h-0 and overflow-hidden for independent phase scroll", () => {
    render(
      <Layout>
        <span>Content</span>
      </Layout>,
    );
    const main = document.querySelector("main");
    expect(main).toBeInTheDocument();
    expect(main).toHaveClass("flex");
    expect(main).toHaveClass("flex-col");
    expect(main).toHaveClass("min-h-0");
    expect(main).toHaveClass("overflow-hidden");
  });
});
