"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Remove existing desktop build artifacts for the given platform/arch so that
 * rerunning the build overwrites them (same behavior as Mac .dmg replace).
 * Removes: artifact file (e.g. Open.Sprint-x64.exe) and unpacked directory.
 *
 * @param {string} platform - win32, darwin, or linux
 * @param {string} arch - x64 or arm64
 * @param {string} [outDir] - output directory (default: package dist)
 */
function cleanStaleDesktopArtifacts(platform, arch, outDir) {
  const dir = outDir ?? path.join(__dirname, "..", "dist");
  const artifactExt = {
    win32: "exe",
    darwin: "dmg",
    linux: "AppImage",
  }[platform];
  const unpackedDir = {
    win32: "win-unpacked",
    darwin: "mac",
    linux: "linux-unpacked",
  }[platform];
  const artifactName = `Open.Sprint-${arch}.${artifactExt}`;
  const artifactPath = path.join(dir, artifactName);
  const unpackedPath = path.join(dir, unpackedDir);

  if (fs.existsSync(artifactPath)) {
    fs.unlinkSync(artifactPath);
    console.log(`Removed stale artifact: ${artifactName}`);
  }
  if (fs.existsSync(unpackedPath) && fs.statSync(unpackedPath).isDirectory()) {
    fs.rmSync(unpackedPath, { recursive: true });
    console.log(`Removed stale unpacked dir: ${unpackedDir}`);
  }
}

module.exports = { cleanStaleDesktopArtifacts };
