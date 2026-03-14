/**
 * Verification test: dev servers use source-direct imports.
 * - Root dev script removes shared/dist first, then watches via concurrently.
 * - Frontend Vite config aliases @opensprint/shared to source for HMR.
 * - Both frontend and backend vitest configs alias to source for npm test.
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
  });

  it("backend vitest.config aliases @opensprint/shared to source", () => {
    const vitestPath = resolve(repoRoot, "packages/backend/vitest.config.ts");
    expect(existsSync(vitestPath)).toBe(true);
    const content = readFileSync(vitestPath, "utf-8");
    expect(content).toContain("@opensprint/shared");
    expect(content).toMatch(/shared\/src\/index\.ts/);
  });

  it("frontend vitest.config aliases @opensprint/shared to source", () => {
    const vitestPath = resolve(repoRoot, "packages/frontend/vitest.config.ts");
    expect(existsSync(vitestPath)).toBe(true);
    const content = readFileSync(vitestPath, "utf-8");
    expect(content).toContain("@opensprint/shared");
    expect(content).toMatch(/shared\/src\/index\.ts/);
  });

  it("shared package exports have src fallback when dist absent", () => {
    const pkg = JSON.parse(readFileSync(resolve(sharedRoot, "package.json"), "utf-8"));
    const exports = pkg.exports?.["."];
    expect(exports).toBeDefined();
    const importPaths = exports.import ?? exports.default;
    const paths = Array.isArray(importPaths) ? importPaths : [importPaths];
    expect(paths.some((p: string) => p.includes("src/index.ts"))).toBe(true);
  });

  it("dev script runs shared in watch mode alongside backend and frontend", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf-8"));
    const devScript = pkg.scripts?.dev ?? "";
    expect(devScript).toContain("dev -w packages/shared");
    expect(devScript).toContain("dev:backend");
    expect(devScript).toContain("dev:frontend");
  });

  it("dev script starts both backend and frontend via concurrently", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf-8"));
    const devScript = pkg.scripts?.dev ?? "";
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

  it("setup script falls back from opensprint login to postgres login for local bootstrap", () => {
    const setupScriptPath = resolve(repoRoot, "scripts/setup.sh");
    expect(existsSync(setupScriptPath)).toBe(true);
    const content = readFileSync(setupScriptPath, "utf-8");
    const appLoginIndex = content.indexOf('can_connect_with_url "$APP_POSTGRES_DB_URL"');
    const postgresLoginIndex = content.indexOf('can_connect_with_url "$POSTGRES_SUPERUSER_DB_URL"');
    const createRoleIndex = content.indexOf(
      "CREATE ROLE ${OS_USER} WITH LOGIN PASSWORD '${OS_PASSWORD}';"
    );
    expect(appLoginIndex).toBeGreaterThanOrEqual(0);
    expect(postgresLoginIndex).toBeGreaterThan(appLoginIndex);
    expect(createRoleIndex).toBeGreaterThan(postgresLoginIndex);
  });

  it("setup script runs local credential bootstrap even when WSL skips service management", () => {
    const setupScriptPath = resolve(repoRoot, "scripts/setup.sh");
    expect(existsSync(setupScriptPath)).toBe(true);
    const content = readFileSync(setupScriptPath, "utf-8");
    const wslMessageIndex = content.indexOf(
      'echo "==> WSL detected. Skipping package-manager and service-manager PostgreSQL setup."'
    );
    const wslBootstrapIndex = content.indexOf(
      "bootstrap_wsl_local_postgres_if_possible",
      wslMessageIndex
    );
    expect(wslMessageIndex).toBeGreaterThanOrEqual(0);
    expect(wslBootstrapIndex).toBeGreaterThan(wslMessageIndex);
  });

  it("setup script supports sudo-based peer auth bootstrap for WSL postgres installs", () => {
    const setupScriptPath = resolve(repoRoot, "scripts/setup.sh");
    expect(existsSync(setupScriptPath)).toBe(true);
    const content = readFileSync(setupScriptPath, "utf-8");
    const peerHelperIndex = content.indexOf(
      "ensure_local_postgres_role_and_databases_via_peer_auth()"
    );
    const sudoPsqlIndex = content.indexOf("sudo -u postgres psql", peerHelperIndex);
    const wslBootstrapCallIndex = content.indexOf(
      "ensure_local_postgres_role_and_databases_via_peer_auth",
      content.indexOf("bootstrap_wsl_local_postgres_if_possible")
    );
    expect(peerHelperIndex).toBeGreaterThanOrEqual(0);
    expect(sudoPsqlIndex).toBeGreaterThan(peerHelperIndex);
    expect(wslBootstrapCallIndex).toBeGreaterThanOrEqual(0);
  });
});
