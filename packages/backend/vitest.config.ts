import { defineConfig } from "vitest/config";

const coverageReporters =
  process.env.CI === "true" || process.env.CI === "1"
    ? ["text-summary", "json-summary", "lcovonly"]
    : ["text", "html", "json-summary"];

export default defineConfig({
  test: {
    projects: [
      "./vitest.unit.config.ts",
      "./vitest.env-route.config.ts",
      "./vitest.integration.config.ts",
    ],
    testTimeout: 30_000,
    coverage: {
      all: true,
      provider: "v8",
      reporter: coverageReporters,
      include: [
        "src/services/**/*.ts",
        "src/routes/**/*.ts",
        "src/middleware/**/*.ts",
        "src/db/**/*.ts",
        "src/utils/**/*.ts",
      ],
      exclude: [
        "src/__tests__/**",
        "src/utils/__tests__/**",
        "src/__tests__/mocks/**",
        "src/index.ts",
        "src/__tests__/setup.ts",
        "src/__tests__/global-setup.ts",
        "src/__tests__/global-teardown.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
