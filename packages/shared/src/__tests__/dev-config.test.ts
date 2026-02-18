/**
 * Verification test: dev servers use source-direct imports.
 * - Root dev script removes shared/dist so package exports fall through to src.
 * - Frontend Vite config aliases @opensprint/shared to source for HMR.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");
const sharedRoot = resolve(__dirname, "../..");

describe("dev config (source-direct imports)", () => {
  it("root dev script removes shared/dist before starting", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf-8")
    );
    const devScript = pkg.scripts?.dev ?? "";
    expect(devScript).toMatch(/rm -rf packages\/shared\/dist/);
    expect(devScript).toContain("concurrently");
  });

  it("frontend vite.config aliases @opensprint/shared to source", () => {
    const viteConfigPath = resolve(repoRoot, "packages/frontend/vite.config.ts");
    expect(existsSync(viteConfigPath)).toBe(true);
    const content = readFileSync(viteConfigPath, "utf-8");
    expect(content).toContain("@opensprint/shared");
    expect(content).toMatch(/shared\/src\/index\.ts/);
  });

  it("shared package exports have src fallback when dist absent", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(sharedRoot, "package.json"), "utf-8")
    );
    const exports = pkg.exports?.["."];
    expect(exports).toBeDefined();
    const importPaths = exports.import ?? exports.default;
    const paths = Array.isArray(importPaths) ? importPaths : [importPaths];
    expect(paths.some((p: string) => p.includes("src/index.ts"))).toBe(true);
  });
});
