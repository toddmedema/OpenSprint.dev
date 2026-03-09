#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const backendDir = path.join(repoRoot, "packages", "backend");
const frontendDir = path.join(repoRoot, "packages", "frontend");
const sharedDir = path.join(repoRoot, "packages", "shared");
const outDir = path.join(repoRoot, "packages", "electron", "desktop-resources");

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function rmRecursive(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) rmRecursive(p);
    else fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
}

console.log("Preparing desktop resources...");

if (fs.existsSync(outDir)) rmRecursive(outDir);
fs.mkdirSync(outDir, { recursive: true });

const backendOut = path.join(outDir, "backend");
const frontendOut = path.join(outDir, "frontend");

fs.mkdirSync(backendOut, { recursive: true });
copyRecursive(path.join(backendDir, "dist"), path.join(backendOut, "dist"));
fs.copyFileSync(
  path.join(backendDir, "package.json"),
  path.join(backendOut, "package.json")
);

const sharedDest = path.join(backendOut, "node_modules", "@opensprint", "shared");
fs.mkdirSync(sharedDest, { recursive: true });
copyRecursive(path.join(sharedDir, "dist"), path.join(sharedDest, "dist"));
fs.copyFileSync(
  path.join(sharedDir, "package.json"),
  path.join(sharedDest, "package.json")
);

console.log("Running npm install (production) in backend...");
execSync("npm install --omit=dev", {
  cwd: backendOut,
  stdio: "inherit",
});

copyRecursive(path.join(frontendDir, "dist"), frontendOut);
console.log("Desktop resources ready at", outDir);
