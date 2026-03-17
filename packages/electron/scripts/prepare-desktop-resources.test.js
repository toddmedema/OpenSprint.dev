import { createRequire } from "module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildElectronRebuildArgs,
  normalizeElectronVersion,
  resolveConfiguredElectronVersion,
  resolveElectronVersion,
  resolveInstalledElectronVersion,
} = require("./prepare-desktop-resources.js");

describe("prepare-desktop-resources", () => {
  it("normalizes semver prefixes", () => {
    expect(normalizeElectronVersion("^41.0.0")).toBe("41.0.0");
    expect(normalizeElectronVersion("  ~41.0.2 ")).toBe("41.0.2");
  });

  it("prefers the installed Electron version for native rebuilds", () => {
    const installed = resolveInstalledElectronVersion();
    expect(installed).toMatch(/^\d+\.\d+\.\d+$/);
    expect(resolveElectronVersion({})).toBe(installed);
  });

  it("lets explicit environment overrides win", () => {
    const previous = process.env.OPENSPRINT_ELECTRON_VERSION;
    process.env.OPENSPRINT_ELECTRON_VERSION = "99.0.0";
    try {
      expect(resolveElectronVersion({})).toBe("99.0.0");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENSPRINT_ELECTRON_VERSION;
      } else {
        process.env.OPENSPRINT_ELECTRON_VERSION = previous;
      }
    }
  });

  it("resolves a configured fallback version from package.json", () => {
    expect(resolveConfiguredElectronVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("uses a real source rebuild for forced native recovery", () => {
    expect(
      buildElectronRebuildArgs({
        electronVersion: "41.0.2",
        moduleDir: "/tmp/backend",
        targetArch: "arm64",
        force: true,
        buildFromSource: true,
      })
    ).toEqual([
      "electron-rebuild",
      "--version",
      "41.0.2",
      "--module-dir",
      "/tmp/backend",
      "--arch",
      "arm64",
      "--force",
      "--build-from-source",
    ]);
  });
});
