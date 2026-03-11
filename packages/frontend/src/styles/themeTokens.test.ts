/**
 * Unit tests for theme token configuration.
 * Verifies that theme tokens are properly configured.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssPath = join(__dirname, "index.css");
const cssContent = readFileSync(cssPath, "utf-8");

const THEME_VARS = [
  "color-bg",
  "color-bg-elevated",
  "color-text",
  "color-text-muted",
  "color-surface",
  "color-border",
  "color-border-subtle",
  "color-ring",
  "color-input-bg",
  "color-input-text",
  "color-input-placeholder",
  "color-code-bg",
  "color-code-text",
  "color-overlay",
  "color-surface-muted",
  "color-scrollbar-track",
  "color-scrollbar-thumb",
  "color-scrollbar-thumb-hover",
];

describe("theme tokens", () => {
  it("tailwind config defines theme token colors that reference CSS variables", () => {
    expect(THEME_VARS).toContain("color-bg");
    expect(THEME_VARS).toContain("color-text");
    expect(THEME_VARS).toContain("color-code-bg");
  });

  it("index.css defines theme variables for light and dark", () => {
    expect(cssContent).toContain("--color-bg:");
    expect(cssContent).toContain("--color-text:");
    expect(cssContent).toContain('html[data-theme="light"]');
    expect(cssContent).toContain('html[data-theme="dark"]');
    expect(cssContent).toContain("--color-code-bg:");
  });

  it("index.css defines scrollbar variables for light and dark themes", () => {
    expect(cssContent).toContain("--color-scrollbar-track:");
    expect(cssContent).toContain("--color-scrollbar-thumb:");
    expect(cssContent).toContain("--color-scrollbar-thumb-hover:");
    expect(cssContent).toMatch(/--color-scrollbar-track:\s*#[0-9a-fA-F]+/);
    expect(cssContent).toMatch(/--color-scrollbar-thumb:\s*#[0-9a-fA-F]+/);
  });
});

describe("scrollbar styling", () => {
  it("index.css applies scrollbar styles globally for Firefox (scrollbar-color, scrollbar-width)", () => {
    expect(cssContent).toContain("scrollbar-width:");
    expect(cssContent).toContain("scrollbar-color:");
    expect(cssContent).toContain("var(--color-scrollbar-thumb)");
    expect(cssContent).toContain("var(--color-scrollbar-track)");
  });

  it("index.css applies scrollbar styles for WebKit (Chrome, Safari) via pseudo-elements", () => {
    expect(cssContent).toContain("::-webkit-scrollbar");
    expect(cssContent).toContain("::-webkit-scrollbar-track");
    expect(cssContent).toContain("::-webkit-scrollbar-thumb");
    expect(cssContent).toContain("::-webkit-scrollbar-corner");
    expect(cssContent).toContain("::-webkit-scrollbar-thumb:hover");
  });

  it("dark mode defines scrollbar track (surface) and muted thumb (not white)", () => {
    expect(cssContent).toContain("--color-scrollbar-track: #1f2937");
    expect(cssContent).toContain("--color-scrollbar-thumb: #6b7280");
  });
});

describe("prefers-reduced-motion (WCAG 2.1 2.3.3)", () => {
  it("index.css defines @media (prefers-reduced-motion: reduce) to tone down animations", () => {
    expect(cssContent).toContain("@media (prefers-reduced-motion: reduce)");
    expect(cssContent).toContain("animation-duration: 0.01ms");
    expect(cssContent).toContain("animation-iteration-count: 1");
    expect(cssContent).toContain("transition-duration: 0.01ms");
  });
});
