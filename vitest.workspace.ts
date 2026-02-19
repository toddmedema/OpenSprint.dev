import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/shared/vitest.config.ts",
  "packages/backend/vitest.config.ts",
  "packages/frontend/vitest.config.ts",
]);
