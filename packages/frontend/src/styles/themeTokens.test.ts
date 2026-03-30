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

  it("legacy --color-* semantic tokens are aliased to --ui-* design token contract", () => {
    expect(cssContent).toContain("--color-error-bg: var(--ui-status-error-bg)");
    expect(cssContent).toContain("--color-success-bg: var(--ui-status-success-bg)");
    expect(cssContent).toContain("--color-graph-edge: var(--ui-graph-edge)");
    expect(cssContent).toContain("--color-status-ready: var(--ui-status-info)");
  });

  it("index.css defines scrollbar variables for light and dark themes", () => {
    expect(cssContent).toContain("--ui-scrollbar-track:");
    expect(cssContent).toContain("--ui-scrollbar-thumb:");
    expect(cssContent).toContain("--ui-scrollbar-thumb-hover:");
    expect(cssContent).toMatch(/--ui-scrollbar-track:\s*#[0-9a-fA-F]+/);
    expect(cssContent).toMatch(/--ui-scrollbar-thumb:\s*#[0-9a-fA-F]+/);
  });
});

describe("scrollbar styling", () => {
  it("index.css applies scrollbar styles globally for Firefox (scrollbar-color, scrollbar-width)", () => {
    expect(cssContent).toContain("scrollbar-width:");
    expect(cssContent).toContain("scrollbar-color:");
    expect(cssContent).toContain("var(--ui-scrollbar-thumb)");
    expect(cssContent).toContain("var(--ui-scrollbar-track)");
  });

  it("index.css applies scrollbar styles for WebKit (Chrome, Safari) via pseudo-elements", () => {
    expect(cssContent).toContain("::-webkit-scrollbar");
    expect(cssContent).toContain("::-webkit-scrollbar-track");
    expect(cssContent).toContain("::-webkit-scrollbar-thumb");
    expect(cssContent).toContain("::-webkit-scrollbar-corner");
    expect(cssContent).toContain("::-webkit-scrollbar-thumb:hover");
  });

  it("dark mode defines scrollbar track (surface) and muted thumb (not white)", () => {
    expect(cssContent).toContain("--ui-scrollbar-track: #1f2937");
    expect(cssContent).toContain("--ui-scrollbar-thumb: #6b7280");
  });
});

/* ---- WCAG AA contrast helpers ---- */

function linearize(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function extractLightModeValue(css: string, varName: string): string | null {
  const lightBlock = css.split('html[data-theme="dark"]')[0];
  const re = new RegExp(`${varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(#[0-9a-fA-F]{6})`);
  const m = lightBlock.match(re);
  return m ? m[1] : null;
}

describe("WCAG AA color contrast (light mode)", () => {
  const LIGHT_PAGE_BG = "#f5f5f7";
  const LIGHT_RAISED_BG = "#ffffff";
  const AA_NORMAL = 4.5;

  it("--ui-text-secondary meets 4.5:1 on page background", () => {
    const color = extractLightModeValue(cssContent, "--ui-text-secondary");
    expect(color).toBeTruthy();
    const ratio = contrastRatio(color!, LIGHT_PAGE_BG);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("--ui-text-secondary meets 4.5:1 on raised surface", () => {
    const color = extractLightModeValue(cssContent, "--ui-text-secondary");
    expect(color).toBeTruthy();
    const ratio = contrastRatio(color!, LIGHT_RAISED_BG);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("--ui-status-warning meets 4.5:1 on raised surface", () => {
    const color = extractLightModeValue(cssContent, "--ui-status-warning");
    expect(color).toBeTruthy();
    const ratio = contrastRatio(color!, LIGHT_RAISED_BG);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("--ui-status-warning meets 4.5:1 on page background", () => {
    const color = extractLightModeValue(cssContent, "--ui-status-warning");
    expect(color).toBeTruthy();
    const ratio = contrastRatio(color!, LIGHT_PAGE_BG);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("--ui-status-success meets 4.5:1 on raised surface", () => {
    const color = extractLightModeValue(cssContent, "--ui-status-success");
    expect(color).toBeTruthy();
    const ratio = contrastRatio(color!, LIGHT_RAISED_BG);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("--ui-status-success meets 4.5:1 on page background", () => {
    const color = extractLightModeValue(cssContent, "--ui-status-success");
    expect(color).toBeTruthy();
    const ratio = contrastRatio(color!, LIGHT_PAGE_BG);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
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
