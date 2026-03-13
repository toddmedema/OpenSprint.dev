#!/usr/bin/env node
"use strict";
/* global require, module, process */
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

module.exports = async function afterPack(context) {
  if (process.platform !== "darwin" || context.electronPlatformName !== "darwin") {
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!fs.existsSync(appPath)) {
    return;
  }

  // We mutate Electron.app during packaging (Info.plist/resources), so always re-sign the bundle.
  execFileSync(
    "/usr/bin/codesign",
    ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath],
    { stdio: "inherit" }
  );

  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
    stdio: "inherit",
  });
};
