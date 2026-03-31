import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["./vitest.unit.config.ts", "./vitest.flow.config.ts"],
    globals: true,
    environment: "jsdom",
    css: false,
    include: ["src/**/*.test.{ts,tsx}", "src/**/*.e2e.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    pool: "forks",
    poolOptions: {
      forks: { minForks: 1, maxForks: 4 },
    },
    testTimeout: 30_000,
    teardownTimeout: 10_000,
    coverage: {
      all: true,
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/__tests__/**",
        "src/test/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/**/*.d.ts",
        "src/components/icons/**",
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 73,
        lines: 80,
      },
    },
  },
});
