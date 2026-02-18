import type { ReactElement } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { Layout } from "./Layout";

const storage: Record<string, string> = {};
beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      Object.keys(storage).forEach((k) => delete storage[k]);
    },
    length: 0,
    key: () => null,
  });
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
  Object.keys(storage).forEach((k) => delete storage[k]);
});

function renderLayout(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("Layout", () => {
  it("renders children in main", () => {
    renderLayout(
      <Layout>
        <span data-testid="child">Content</span>
      </Layout>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("has main with flex flex-col min-h-0 and overflow-hidden for independent phase scroll", () => {
    renderLayout(
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
