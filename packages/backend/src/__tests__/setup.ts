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
import { vi } from "vitest";

process.env.GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME || "Open Sprint Test";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL || "test@opensprint.dev";
process.env.GIT_COMMITTER_NAME = process.env.GIT_COMMITTER_NAME || process.env.GIT_AUTHOR_NAME;
process.env.GIT_COMMITTER_EMAIL = process.env.GIT_COMMITTER_EMAIL || process.env.GIT_AUTHOR_EMAIL;
process.env.OPENSPRINT_RESULT_POLL_MS = process.env.OPENSPRINT_RESULT_POLL_MS || "100";

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
