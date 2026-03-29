import path from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";
import { defineProject } from "vitest/config";
import { frontendCommonTestConfig, frontendFlowInclude } from "./vitest.shared.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineProject({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      "@opensprint/shared": path.resolve(__dirname, "../shared/src/index.ts"),
      "@opensprint/shared/types": path.resolve(__dirname, "../shared/src/types/index.ts"),
      "@opensprint/shared/constants": path.resolve(__dirname, "../shared/src/constants/index.ts"),
      "@opensprint/shared/runtime": path.resolve(__dirname, "../shared/src/runtime/index.ts"),
    },
  },
  test: {
    ...frontendCommonTestConfig,
    name: "frontend-flow",
    include: frontendFlowInclude,
    pool: "forks",
    poolOptions: {
      forks: { minForks: 1, maxForks: 2 },
    },
  },
});
