/**
 * Unit test: desktop build artifact names are fixed (no version) for stable permalinks.
 * Matches checks in scripts/verify-desktop-artifact-names.js.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sharedRoot = resolve(__dirname, "../..");
const electronPkgPath = resolve(sharedRoot, "../electron/package.json");

describe("desktop artifact names (fixed for permalinks)", () => {
  it("electron build.mac.artifactName is set and does not contain version", () => {
    const pkg = JSON.parse(readFileSync(electronPkgPath, "utf-8"));
    const name = pkg.build?.mac?.artifactName;
    expect(name).toBeDefined();
    expect(name).not.toContain("${version}");
  });

  it("electron build.win.artifactName is set and does not contain version", () => {
    const pkg = JSON.parse(readFileSync(electronPkgPath, "utf-8"));
    const name = pkg.build?.win?.artifactName;
    expect(name).toBeDefined();
    expect(name).not.toContain("${version}");
  });

  it("electron build.linux.artifactName is set and does not contain version", () => {
    const pkg = JSON.parse(readFileSync(electronPkgPath, "utf-8"));
    const name = pkg.build?.linux?.artifactName;
    expect(name).toBeDefined();
    expect(name).not.toContain("${version}");
  });
});
