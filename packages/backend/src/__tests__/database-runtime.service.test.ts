import { describe, it, expect, vi } from "vitest";
import { AppError } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";
import { DatabaseRuntimeService } from "../services/database-runtime.service.js";

const TEST_DB_URL = "postgresql://opensprint:opensprint@localhost:5432/opensprint";

describe("DatabaseRuntimeService", () => {
  it("starts disconnected and reports classified status when probe fails", async () => {
    const runtime = new DatabaseRuntimeService({
      resolveConfig: async () => ({ databaseUrl: TEST_DB_URL, source: "default" }),
      probe: async () => {
        throw { code: "ECONNREFUSED" };
      },
      initialSnapshot: {
        ok: false,
        state: "disconnected",
        message: null,
        lastCheckedAt: null,
        lastSuccessAt: null,
      },
    });

    runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await runtime.getStatus()).toMatchObject({
      ok: false,
      state: "disconnected",
      message:
        "The database server could not be reached; make sure PostgreSQL is running and the host and port in your settings are correct.",
    });
  });

  it("calls onConnected when probe succeeds", async () => {
    const onConnected = vi.fn();
    const runtime = new DatabaseRuntimeService({
      resolveConfig: async () => ({ databaseUrl: TEST_DB_URL, source: "default" }),
      probe: async () => undefined,
      initialSnapshot: {
        ok: false,
        state: "disconnected",
        message: null,
        lastCheckedAt: null,
        lastSuccessAt: null,
      },
    });
    runtime.setLifecycleHandlers({ onConnected });

    runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onConnected).toHaveBeenCalledWith({
      databaseUrl: TEST_DB_URL,
      source: "default",
      reason: "startup",
      message: null,
    });
    expect(await runtime.getStatus()).toMatchObject({
      ok: true,
      state: "connected",
    });
  });

  it("reports connected as soon as probe succeeds even while onConnected is still running", async () => {
    let finishOnConnected: (() => void) | null = null;
    const onConnected = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishOnConnected = resolve;
        })
    );

    const runtime = new DatabaseRuntimeService({
      resolveConfig: async () => ({ databaseUrl: TEST_DB_URL, source: "default" }),
      probe: async () => undefined,
      initialSnapshot: {
        ok: false,
        state: "disconnected",
        message: null,
        lastCheckedAt: null,
        lastSuccessAt: null,
      },
    });
    runtime.setLifecycleHandlers({ onConnected });

    runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await runtime.getStatus()).toMatchObject({
      ok: true,
      state: "connected",
    });
    await expect(runtime.requireDatabase()).resolves.toBeUndefined();

    finishOnConnected?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("transitions to disconnected on runtime operational failure", async () => {
    const onDisconnected = vi.fn();
    const runtime = new DatabaseRuntimeService({
      resolveConfig: async () => ({ databaseUrl: TEST_DB_URL, source: "default" }),
      probe: async () => undefined,
      initialSnapshot: {
        ok: false,
        state: "disconnected",
        message: null,
        lastCheckedAt: null,
        lastSuccessAt: null,
      },
    });
    runtime.setLifecycleHandlers({ onDisconnected });

    runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    runtime.handleOperationalFailure(
      new AppError(
        503,
        ErrorCodes.DATABASE_UNAVAILABLE,
        "The database server could not be reached; make sure PostgreSQL is running and the host and port in your settings are correct."
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onDisconnected).toHaveBeenCalled();
    expect(await runtime.getStatus()).toMatchObject({
      ok: false,
      state: "disconnected",
      message:
        "The database server could not be reached; make sure PostgreSQL is running and the host and port in your settings are correct.",
    });
  });

  it("reports test database config as disconnected instead of throwing", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const runtime = new DatabaseRuntimeService({
        resolveConfig: async () => ({
          databaseUrl: "postgresql://opensprint:opensprint@localhost:5432/opensprint_test",
          source: "env",
        }),
        probe: async () => undefined,
        initialSnapshot: {
          ok: false,
          state: "disconnected",
          message: null,
          lastCheckedAt: null,
          lastSuccessAt: null,
        },
      });

      runtime.start();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(await runtime.getStatus()).toMatchObject({
        ok: false,
        state: "disconnected",
      });
      expect((await runtime.getStatus()).message).toContain("opensprint_test");
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("allows the test database when NODE_ENV is test", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      const runtime = new DatabaseRuntimeService({
        resolveConfig: async () => ({
          databaseUrl: "postgresql://opensprint:opensprint@localhost:5432/opensprint_test",
          source: "env",
        }),
        probe: async () => undefined,
        initialSnapshot: {
          ok: false,
          state: "disconnected",
          message: null,
          lastCheckedAt: null,
          lastSuccessAt: null,
        },
      });

      runtime.start();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(await runtime.getStatus()).toMatchObject({
        ok: true,
        state: "connected",
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
