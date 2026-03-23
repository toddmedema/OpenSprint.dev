import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const {
  buildElectronRebuildArgs,
  normalizeElectronVersion,
  resolveConfiguredElectronVersion,
  resolveElectronVersion,
  resolveInstalledElectronVersion,
} = require("./prepare-desktop-resources.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  it("includes light, dark, and tinted Icon Composer variants for macOS builds", () => {
    const iconJsonPath = path.join(__dirname, "..", "build", "OpenSprint.icon", "icon.json");
    const iconJson = JSON.parse(fs.readFileSync(iconJsonPath, "utf8"));
    const layer = iconJson.groups[0].layers[0];
    const specializations = layer["image-name-specializations"];

    expect(specializations).toEqual([
      { value: "light.png" },
      { appearance: "dark", value: "dark.png" },
      { appearance: "tinted", value: "tinted.png" },
    ]);
    expect(layer.position["translation-in-points"]).toEqual([0, 0]);
  });

  it("keeps the rasterized artwork optically shifted toward center", async () => {
    const sharp = require("sharp");
    const lightIconPath = path.join(
      __dirname,
      "..",
      "build",
      "OpenSprint.icon",
      "Assets",
      "light.png"
    );
    const { data, info } = await sharp(lightIconPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let minX = info.width;
    let maxX = -1;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const alpha = data[(y * info.width + x) * 4 + 3];
        if (alpha <= 10) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }

    const centerX = (minX + maxX) / 2;
    expect(centerX).toBeGreaterThan(525);
    expect(centerX).toBeLessThan(540);
  });
});
