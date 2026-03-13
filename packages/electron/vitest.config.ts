import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["scripts/**/*.test.{js,mjs,ts}"],
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      // Resolve scripts from package root
      ".": path.resolve(__dirname, "."),
    },
  },
});
