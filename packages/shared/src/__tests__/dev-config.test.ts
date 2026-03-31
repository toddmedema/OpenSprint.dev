/**
 * Verification test: dev servers use source-direct imports.
 * - Root dev script removes shared/dist first, then watches via concurrently.
 * - Frontend Vite config aliases @opensprint/shared to source for HMR.
 * - Backend and frontend Vitest project configs alias to source for npm test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");
const sharedRoot = resolve(__dirname, "../..");

describe("dev config (source-direct imports)", () => {
  it("root dev script removes shared/dist and starts concurrently", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf-8"));
    const devScript = pkg.scripts?.dev ?? "";
    expect(devScript).toContain("rm -rf packages/shared/dist");
    expect(devScript).toContain("concurrently");
  });

  it("frontend vite.config aliases @opensprint/shared to source", () => {
    const viteConfigPath = resolve(repoRoot, "packages/frontend/vite.config.ts");
    expect(existsSync(viteConfigPath)).toBe(true);
    const content = readFileSync(viteConfigPath, "utf-8");
    expect(content).toContain("@opensprint/shared");
    expect(content).toMatch(/shared\/src\/index\.ts/);
    expect(content).toMatch(/shared\/src\/types\/index\.ts/);
    expect(content).toMatch(/shared\/src\/runtime\/index\.ts/);
  });

  it("backend vitest shared config aliases @opensprint/shared to source", () => {
    const vitestPath = resolve(repoRoot, "packages/backend/vitest.shared.ts");
    expect(existsSync(vitestPath)).toBe(true);
    const content = readFileSync(vitestPath, "utf-8");
    expect(content).toContain("@opensprint/shared");
    expect(content).toMatch(/shared\/src\/index\.ts/);
    expect(content).toMatch(/shared\/src\/constants\/index\.ts/);
  });

  it("frontend Vitest project configs alias @opensprint/shared to source", () => {
    const vitestPaths = [
      resolve(repoRoot, "packages/frontend/vitest.unit.config.ts"),
      resolve(repoRoot, "packages/frontend/vitest.flow.config.ts"),
    ];
    for (const vitestPath of vitestPaths) {
      expect(existsSync(vitestPath)).toBe(true);
      const content = readFileSync(vitestPath, "utf-8");
      expect(content).toContain("@opensprint/shared");
      expect(content).toMatch(/shared\/src\/index\.ts/);
      expect(content).toMatch(/shared\/src\/types\/index\.ts/);
    }
  });

  it("workspace tsconfig path aliases resolve shared source directly in development", () => {
    const frontendTsconfig = JSON.parse(
      readFileSync(resolve(repoRoot, "packages/frontend/tsconfig.json"), "utf-8")
    );
    expect(frontendTsconfig.compilerOptions?.paths?.["@opensprint/shared"]).toEqual([
      "../shared/src/index.ts",
    ]);
    expect(frontendTsconfig.compilerOptions?.paths?.["@opensprint/shared/types"]).toEqual([
      "../shared/src/types/index.ts",
    ]);
  });

  it("shared package exports do not depend on generated src artifacts", () => {
    const pkg = JSON.parse(readFileSync(resolve(sharedRoot, "package.json"), "utf-8"));
    const exports = pkg.exports?.["."];
    expect(exports).toBeDefined();
    expect(exports.import).toBe("./dist/index.js");
    expect(exports.types).toBe("./dist/index.d.ts");
  });

  it("dev script runs shared in watch mode alongside backend and frontend", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf-8"));
    const devScript = pkg.scripts?.dev ?? "";
    expect(devScript).toContain("dev -w packages/shared");
    expect(devScript).toContain("dev:backend");
    expect(devScript).toContain("dev:frontend");
  });

  it("setup script builds shared before applying database schema", () => {
    const setupScriptPath = resolve(repoRoot, "scripts/setup.sh");
    expect(existsSync(setupScriptPath)).toBe(true);
    const content = readFileSync(setupScriptPath, "utf-8");
    const buildIndex = content.indexOf("npm run build -w packages/shared");
    const schemaIndex = content.indexOf("npx tsx scripts/ensure-db-schema.ts");
    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(schemaIndex).toBeGreaterThan(buildIndex);
  });

  it("setup script handles app-login and postgres-superuser credential bootstrap", () => {
    const setupScriptPath = resolve(repoRoot, "scripts/setup.sh");
    expect(existsSync(setupScriptPath)).toBe(true);
    const content = readFileSync(setupScriptPath, "utf-8");
    expect(content).toContain("APP_POSTGRES_DB_URL");
    expect(content).toContain("POSTGRES_SUPERUSER_DB_URL");
    expect(content).toMatch(/CREATE ROLE.*WITH LOGIN PASSWORD/);
  });

  it("setup script provides WSL-specific postgres bootstrap path", () => {
    const setupScriptPath = resolve(repoRoot, "scripts/setup.sh");
    expect(existsSync(setupScriptPath)).toBe(true);
    const content = readFileSync(setupScriptPath, "utf-8");
    expect(content).toMatch(/WSL.*detect/i);
    expect(content).toContain("bootstrap_wsl_local_postgres_if_possible");
    expect(content).toContain("ensure_local_postgres_role_and_databases_via_peer_auth");
    expect(content).toContain("sudo -u postgres psql");
  });
});
