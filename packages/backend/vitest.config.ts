import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@opensprint/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts", "src/utils/__tests__/**/*.test.ts"],
    exclude: ["**/git-working-mode-branches.integration.test.ts"],
    pool: "forks",
    poolOptions: {
      forks: { minForks: 1, maxForks: 4 },
    },
    testTimeout: 30_000,
    teardownTimeout: 25_000,
    hookTimeout: 25_000,
    coverage: {
      provider: "v8",
      include: ["src/services/**"],
      exclude: ["src/__tests__/**"],
    },
  },
});
