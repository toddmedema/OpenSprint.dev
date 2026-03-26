import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sharedRoot = resolve(__dirname, "../..");
const repoRoot = resolve(sharedRoot, "../..");
const workflowPath = resolve(repoRoot, ".github/workflows/merge-gate.yml");

describe("merge-gate workflow", () => {
  it("runs perf against the test database with explicit test NODE_ENV", () => {
    const workflow = readFileSync(workflowPath, "utf-8");
    expect(workflow).toContain("POSTGRES_DB: opensprint_test");
    expect(workflow).toContain(
      "DATABASE_URL: postgres://opensprint:opensprint@localhost:5432/opensprint_test"
    );
    expect(workflow).toContain("NODE_ENV: test");
  });
});
