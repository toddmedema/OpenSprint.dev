/**
 * Vitest setup file: mocks @google/genai so tests that transitively import agent-client
 * (via app, composition, agent.service, etc.) do not fail with "Failed to load url @google/genai".
 * The package has ESM resolution issues under Vite's transform; this mock is applied before
 * any test file loads.
 *
 * Drizzle-orm / pg-core: Tests that mock task-store (or other modules) with vi.mock(..., async (importOriginal) => ...)
 * should avoid loading drizzle-orm/pg-core in the same file when the mock uses importOriginal, because
 * Vitest's resolution can fail in some workspaces. In those tests, mock drizzle-orm (and optionally
 * ../db/drizzle-schema-pg.js) before importing the module under test. See test files that use
 * createMockDbClient or task-store mocks for examples.
 */
import { afterEach, vi } from "vitest";
import events from "events";
import fs from "fs";
import os from "os";
import path from "path";

// Integration tests create many concurrent supertest HTTP connections,
// each adding listeners (unpipe, error, close, finish) to internal Sockets.
// Raise the global ceiling to avoid MaxListenersExceededWarning noise in CI.
events.defaultMaxListeners = 50;
events.setMaxListeners(50);

process.env.GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME || "Open Sprint Test";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL || "test@opensprint.dev";
process.env.GIT_COMMITTER_NAME = process.env.GIT_COMMITTER_NAME || process.env.GIT_AUTHOR_NAME;
process.env.GIT_COMMITTER_EMAIL = process.env.GIT_COMMITTER_EMAIL || process.env.GIT_AUTHOR_EMAIL;
process.env.OPENSPRINT_RESULT_POLL_MS = process.env.OPENSPRINT_RESULT_POLL_MS || "100";

/**
 * Protect local developer state from accidental test writes.
 * Many services default to ~/.opensprint when no test override is provided.
 * We pin HOME/USERPROFILE to a per-worker temp directory so tests never touch
 * real settings or project index files on the host machine.
 */
const setupGlobal = globalThis as typeof globalThis & {
  __opensprintTestHomeDir?: string;
};
if (!setupGlobal.__opensprintTestHomeDir) {
  const testHomeDir = path.join(
    os.tmpdir(),
    "opensprint-vitest-home",
    `${process.pid}-${Date.now().toString(36)}`
  );
  fs.mkdirSync(testHomeDir, { recursive: true });
  setupGlobal.__opensprintTestHomeDir = testHomeDir;
}
process.env.HOME = setupGlobal.__opensprintTestHomeDir;
process.env.USERPROFILE = setupGlobal.__opensprintTestHomeDir;

/**
 * Fake timers leak across sequential unit-test files in the same worker (Vitest forks,
 * maxWorkers: 1). Left enabled, they stall real async I/O — e.g. supertest never completes
 * and hits the default 30s test timeout. Always return to real timers after each test.
 */
afterEach(() => {
  vi.useRealTimers();
});

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: "mock response" }] } }],
      }),
      generateContentStream: vi.fn().mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { candidates: [{ content: { parts: [{ text: "mock" }] } }] };
        },
      }),
    },
  })),
}));
