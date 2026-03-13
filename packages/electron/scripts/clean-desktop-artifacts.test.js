import fs from "fs";
import path from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { createRequire } from "module";
import { describe, it, beforeAll, afterAll, expect } from "vitest";

const require = createRequire(import.meta.url);
const { cleanStaleDesktopArtifacts } = require("./clean-desktop-artifacts.js");

describe("clean-desktop-artifacts", () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "opensprint-electron-test-"));
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  it("removes existing Windows .exe artifact", () => {
    const exePath = path.join(tmpDir, "Open.Sprint-x64.exe");
    fs.writeFileSync(exePath, "fake-exe");
    expect(fs.existsSync(exePath)).toBe(true);
    cleanStaleDesktopArtifacts("win32", "x64", tmpDir);
    expect(fs.existsSync(exePath)).toBe(false);
  });

  it("removes existing Windows win-unpacked directory", () => {
    const unpacked = path.join(tmpDir, "win-unpacked");
    fs.mkdirSync(path.join(unpacked, "sub"), { recursive: true });
    fs.writeFileSync(path.join(unpacked, "file.txt"), "x");
    expect(fs.existsSync(unpacked)).toBe(true);
    cleanStaleDesktopArtifacts("win32", "x64", tmpDir);
    expect(fs.existsSync(unpacked)).toBe(false);
  });

  it("removes existing Mac .dmg artifact", () => {
    const dmgPath = path.join(tmpDir, "Open.Sprint-arm64.dmg");
    fs.writeFileSync(dmgPath, "fake-dmg");
    expect(fs.existsSync(dmgPath)).toBe(true);
    cleanStaleDesktopArtifacts("darwin", "arm64", tmpDir);
    expect(fs.existsSync(dmgPath)).toBe(false);
  });

  it("removes existing darwin mac unpacked directory", () => {
    const unpacked = path.join(tmpDir, "mac");
    fs.mkdirSync(unpacked, { recursive: true });
    expect(fs.existsSync(unpacked)).toBe(true);
    cleanStaleDesktopArtifacts("darwin", "x64", tmpDir);
    expect(fs.existsSync(unpacked)).toBe(false);
  });

  it("removes existing Linux AppImage artifact", () => {
    const appPath = path.join(tmpDir, "Open.Sprint-x64.AppImage");
    fs.writeFileSync(appPath, "fake-appimage");
    expect(fs.existsSync(appPath)).toBe(true);
    cleanStaleDesktopArtifacts("linux", "x64", tmpDir);
    expect(fs.existsSync(appPath)).toBe(false);
  });

  it("does not throw when artifact and unpacked dir are missing", () => {
    expect(() => {
      cleanStaleDesktopArtifacts("win32", "x64", tmpDir);
    }).not.toThrow();
  });
});
