import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, useTheme } from "./ThemeContext";

const storage: Record<string, string> = {};
let matchMediaMatches = false;

function TestConsumer() {
  const { preference, resolved, setTheme, setForceLightMode } = useTheme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <button type="button" onClick={() => setTheme("light")}>
        Light
      </button>
      <button type="button" onClick={() => setTheme("dark")}>
        Dark
      </button>
      <button type="button" onClick={() => setTheme("system")}>
        System
      </button>
      <button type="button" onClick={() => setForceLightMode(true)}>
        Force Light
      </button>
      <button type="button" onClick={() => setForceLightMode(false)}>
        Unforce Light
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
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
      matches: matchMediaMatches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    matchMediaMatches = false;
    Object.keys(storage).forEach((k) => delete storage[k]);
  });

  it("provides theme context to children", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );
    expect(screen.getByTestId("preference")).toHaveTextContent("system");
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
  });

  it("updates preference and resolved when setTheme(light) is called", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );
    await user.click(screen.getByRole("button", { name: "Light" }));
    expect(screen.getByTestId("preference")).toHaveTextContent("light");
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("updates preference and resolved when setTheme(dark) is called", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );
    await user.click(screen.getByRole("button", { name: "Dark" }));
    expect(screen.getByTestId("preference")).toHaveTextContent("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("uses stored preference on mount", () => {
    storage["opensprint.theme"] = "dark";
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );
    expect(screen.getByTestId("preference")).toHaveTextContent("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
  });

  it("setForceLightMode(true) forces data-theme=light regardless of preference (Sketch phase)", async () => {
    const user = userEvent.setup();
    storage["opensprint.theme"] = "dark";
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    await user.click(screen.getByRole("button", { name: "Force Light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(screen.getByTestId("preference")).toHaveTextContent("dark");
  });

  it("setForceLightMode(false) restores theme to resolved preference", async () => {
    const user = userEvent.setup();
    storage["opensprint.theme"] = "dark";
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );
    await user.click(screen.getByRole("button", { name: "Force Light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    await user.click(screen.getByRole("button", { name: "Unforce Light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("useTheme", () => {
  it("throws when used outside ThemeProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      function Bad() {
        useTheme();
        return null;
      }
      render(<Bad />);
    }).toThrow("useTheme must be used within ThemeProvider");
    vi.restoreAllMocks();
  });
});
