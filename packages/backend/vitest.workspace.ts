import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "./vitest.unit.config.ts",
  "./vitest.env-route.config.ts",
  "./vitest.integration.config.ts",
]);
