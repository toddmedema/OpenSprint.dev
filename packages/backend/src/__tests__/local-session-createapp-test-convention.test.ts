import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const CREATE_APP_IMPORT = /from\s+["']\.\.\/app\.js["']/;
const USES_CREATE_APP = /\bcreateApp\s*\(/;
const USES_RAW_REQUEST = /\brequest\s*\(\s*app\s*\)/;

function* walkTestTsFiles(dir: string): Generator<string> {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walkTestTsFiles(p);
    } else if (ent.name.endsWith(".test.ts")) {
      yield p;
    }
  }
}

describe("createApp integration tests — local session auth convention", () => {
  it("files that import createApp from app.js must not use raw request(app) (except app.test.ts)", () => {
    const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const offenders: string[] = [];

    for (const file of walkTestTsFiles(srcRoot)) {
      if (!file.includes(`${path.sep}__tests__${path.sep}`)) {
        continue;
      }
      if (path.basename(file) === "app.test.ts") {
        continue;
      }

      const text = readFileSync(file, "utf8");
      if (!CREATE_APP_IMPORT.test(text) || !USES_CREATE_APP.test(text)) {
        continue;
      }
      if (USES_RAW_REQUEST.test(text)) {
        offenders.push(path.relative(srcRoot, file).split(path.sep).join("/"));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("env-route.test.ts does not use raw request(app) (use authedSupertest for /api/v1/env parity)", () => {
    const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const file = path.join(srcRoot, "__tests__", "env-route.test.ts");
    const text = readFileSync(file, "utf8");
    expect(text).not.toMatch(/\brequest\s*\(\s*app\s*\)/);
  });
});
