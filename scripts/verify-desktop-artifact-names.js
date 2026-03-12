#!/usr/bin/env node
"use strict";

/**
 * Verifies desktop build artifact names are fixed (no version) for stable permalinks.
 * Run: node scripts/verify-desktop-artifact-names.js
 * Or: npm run verify:desktop-artifacts
 *
 * Ensures mac, win, and linux artifactName do not contain ${version} so that
 * .../releases/latest/download/Open.Sprint-<arch>.<ext> always serves the latest build.
 */

const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..");
const pkgPath = path.join(root, "packages", "electron", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const build = pkg.build || {};

const platforms = [
  { key: "mac", label: "mac" },
  { key: "win", label: "win" },
  { key: "linux", label: "linux" },
];

let failed = false;
for (const { key, label } of platforms) {
  const section = build[key];
  const name = section?.artifactName;
  if (!name) {
    console.error(`ERROR: packages/electron/package.json build.${key}.artifactName is missing`);
    failed = true;
    continue;
  }
  if (name.includes("${version}")) {
    console.error(
      `ERROR: build.${key}.artifactName must not contain \${version} (use fixed names for permalinks). Got: ${name}`
    );
    failed = true;
    continue;
  }
  console.log(`OK: ${label} artifactName is fixed (no version): ${name}`);
}

if (failed) process.exit(1);
console.log("All desktop artifact names are fixed for stable permalinks.");
