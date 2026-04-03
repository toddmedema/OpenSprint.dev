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

  it("summarizes Vitest reports before uploading CI artifacts", () => {
    const workflow = readFileSync(workflowPath, "utf-8");
    expect(workflow).toContain("Summarize test reports");
    expect(workflow).toContain("node scripts/ci/summarize-test-results.mjs artifacts/test-results");
    expect(workflow).toContain("merge-gate-test-reports-run-${{ github.run_id }}");
  });

  it("runs electron coverage when the electron workspace is affected", () => {
    const workflow = readFileSync(workflowPath, "utf-8");
    expect(workflow).toContain("Run electron tests with coverage");
    expect(workflow).toContain("test:coverage -w packages/electron");
    expect(workflow).toContain("electron-junit.xml");
  });
});
