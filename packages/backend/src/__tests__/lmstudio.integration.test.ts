/**
 * Integration tests for LM Studio agent: planning invoke and Coder spawnWithTaskFile.
 * - When LM_STUDIO_URL is set: runs real planning invoke (streaming + completion) and
 *   Coder spawnWithTaskFile (streaming + exit code). Skipped in CI when LM Studio is not running.
 * - When LM Studio is unavailable: asserts connection error and that user-facing message
 *   mentions starting LM Studio or checking URL (tests always run, use unreachable URL).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { AgentClient } from "../services/agent-client.js";
import type { AgentConfig } from "@opensprint/shared";

// Avoid loading drizzle-orm/pg-core (vitest resolution can fail in some workspaces)
vi.mock("drizzle-orm", () => ({ and: (...args: unknown[]) => args, eq: (a: unknown, b: unknown) => [a, b] }));
vi.mock("../db/drizzle-schema-pg.js", () => ({ plansTable: {} }));

const LM_STUDIO_URL = process.env.LM_STUDIO_URL;
const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL ?? "local";

/** Unreachable URL for "unavailable" tests (no server on this port). */
const UNREACHABLE_BASE_URL = "http://127.0.0.1:19999";

function lmStudioAvailable(): boolean {
  return Boolean(LM_STUDIO_URL && LM_STUDIO_URL.trim().length > 0);
}

describe("LM Studio integration", () => {
  let client: AgentClient;

  beforeEach(() => {
    client = new AgentClient();
  });

  describe("when LM Studio is available", () => {
    describe.skipIf(!lmStudioAvailable())(
      "planning invoke and Coder spawnWithTaskFile (requires LM_STUDIO_URL and running LM Studio)",
      () => {
        const baseUrl = (LM_STUDIO_URL ?? "").replace(/\/+$/, "");
        const config: AgentConfig = {
          type: "lmstudio",
          model: LM_STUDIO_MODEL,
          cliCommand: null,
          baseUrl: baseUrl || undefined,
        };

        it("planning invoke: streams and completes", async () => {
          const chunks: string[] = [];
          const result = await client.invoke({
            config,
            prompt: "Reply with exactly: OK",
            systemPrompt: "You are a helpful assistant. Reply briefly.",
            onChunk: (chunk) => chunks.push(chunk),
          });

          expect(result.content).toBeDefined();
          expect(typeof result.content).toBe("string");
          const fullFromChunks = chunks.join("");
          expect(fullFromChunks).toBe(result.content);
          expect(chunks.length).toBeGreaterThanOrEqual(0);
          if (result.content.length > 0) {
            expect(chunks.some((c) => c.length > 0)).toBe(true);
          }
        });

        it("Coder spawnWithTaskFile: streams and exits 0", async () => {
          const tmpDir = path.join(os.tmpdir(), `lmstudio-integration-${Date.now()}`);
          const taskDir = path.join(tmpDir, ".opensprint", "active", "os-lm.1");
          await fs.mkdir(taskDir, { recursive: true });
          const taskFilePath = path.join(taskDir, "prompt.md");
          await fs.writeFile(
            taskFilePath,
            "# Task\n\nReply with exactly: DONE",
            "utf-8"
          );

          const outputChunks: string[] = [];
          let exitCode: number | null = null;
          const onOutput = (chunk: string) => outputChunks.push(chunk);
          const onExit = (code: number | null) => {
            exitCode = code;
          };

          const { kill, pid } = client.spawnWithTaskFile(
            config,
            taskFilePath,
            tmpDir,
            onOutput,
            onExit,
            "coder"
          );

          expect(pid).toBeNull();
          expect(typeof kill).toBe("function");

          await new Promise<void>((resolve, reject) => {
            const deadline = Date.now() + 60_000;
            const t = setInterval(() => {
              if (exitCode !== null) {
                clearInterval(t);
                resolve();
                return;
              }
              if (Date.now() > deadline) {
                clearInterval(t);
                reject(new Error("spawnWithTaskFile did not call onExit within 60s"));
              }
            }, 200);
          });

          expect(exitCode).toBe(0);
          const fullOutput = outputChunks.join("");
          expect(fullOutput.length).toBeGreaterThanOrEqual(0);
          if (fullOutput.length > 0) {
            expect(outputChunks.some((c) => c.length > 0)).toBe(true);
          }

          await fs.rm(tmpDir, { recursive: true, force: true });
        });
      }
    );
  });

  describe("when LM Studio is unavailable", () => {
    const unavailableConfig: AgentConfig = {
      type: "lmstudio",
      model: "local",
      cliCommand: null,
      baseUrl: UNREACHABLE_BASE_URL,
    };

    it("invoke throws with user-facing message mentioning LM Studio or starting/URL", async () => {
      await expect(
        client.invoke({
          config: unavailableConfig,
          prompt: "Hello",
        })
      ).rejects.toThrow(/LM Studio/i);

      try {
        await client.invoke({
          config: unavailableConfig,
          prompt: "Hello",
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toMatch(/LM Studio/i);
        const hintsStartOrUrl =
          /Start|running|port|URL|server|localhost|1234/i.test(message);
        expect(hintsStartOrUrl).toBe(true);
      }
    });

    it("spawnWithTaskFile calls onExit(1) and emits message mentioning LM Studio or URL", async () => {
      const tmpDir = path.join(os.tmpdir(), `lmstudio-unavailable-${Date.now()}`);
      const taskDir = path.join(tmpDir, ".opensprint", "active", "os-bad.1");
      await fs.mkdir(taskDir, { recursive: true });
      const taskFilePath = path.join(taskDir, "prompt.md");
      await fs.writeFile(taskFilePath, "# Task\n\nHello", "utf-8");

      const outputChunks: string[] = [];
      let exitCode: number | null = null;
      const onOutput = (chunk: string) => outputChunks.push(chunk);
      const onExit = (code: number | null) => {
        exitCode = code;
      };

      client.spawnWithTaskFile(
        unavailableConfig,
        taskFilePath,
        tmpDir,
        onOutput,
        onExit,
        "coder"
      );

      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 10_000;
        const t = setInterval(() => {
          if (exitCode !== null) {
            clearInterval(t);
            resolve();
            return;
          }
          if (Date.now() > deadline) {
            clearInterval(t);
            reject(new Error("onExit not called within 10s"));
          }
        }, 100);
      });

      expect(exitCode).toBe(1);
      const fullOutput = outputChunks.join("");
      expect(fullOutput).toMatch(/LM Studio/i);
      const hintsStartOrUrl =
        /Start|running|port|URL|server|localhost|1234/i.test(fullOutput);
      expect(hintsStartOrUrl).toBe(true);

      await fs.rm(tmpDir, { recursive: true, force: true });
    });
  });
});
