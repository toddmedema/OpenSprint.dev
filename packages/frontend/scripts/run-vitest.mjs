#!/usr/bin/env node
/**
 * Forwards to vitest; maps Jest-style `--testPathPattern=<name>` to a Vitest file filter
 * so `npm test -- --testPathPattern=ExecutePhase` works in this workspace.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const patternIdx = args.findIndex((a) => a.startsWith("--testPathPattern="));
const vitestArgs = ["vitest", "run"];
if (patternIdx !== -1) {
  const raw = args[patternIdx];
  const value = raw.slice("--testPathPattern=".length);
  // Jest-style alternation: match files across Vitest workspace projects (unit vs flow).
  const patterns = value
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  vitestArgs.push(...patterns);
  vitestArgs.push(...args.filter((_, i) => i !== patternIdx));
} else {
  vitestArgs.push(...args);
}
const r = spawnSync("npx", vitestArgs, { stdio: "inherit", cwd: root });
process.exit(r.status ?? 1);
