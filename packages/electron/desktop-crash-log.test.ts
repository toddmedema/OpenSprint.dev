import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import {
  appendDesktopCrashLog,
  setDesktopSessionId,
} from "./desktop-crash-log";

describe("appendDesktopCrashLog", () => {
  let mkdirSyncSpy: ReturnType<typeof vi.spyOn>;
  let appendFileSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mkdirSyncSpy = vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined);
    appendFileSyncSpy = vi.spyOn(fs, "appendFileSync").mockReturnValue(undefined);
    setDesktopSessionId("test-session-123");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setDesktopSessionId("unknown");
  });

  it("writes a valid JSONL line to the crash log file", () => {
    appendDesktopCrashLog("test.event", { key: "value" });

    expect(mkdirSyncSpy).toHaveBeenCalledTimes(1);
    expect(appendFileSyncSpy).toHaveBeenCalledTimes(1);

    const written = appendFileSyncSpy.mock.calls[0][1] as string;
    expect(written.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(written.trim()) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      event: "test.event",
      sessionId: "test-session-123",
      pid: process.pid,
      payload: { key: "value" },
    });
    expect(typeof parsed.ts).toBe("string");
  });

  it("includes the configured session ID", () => {
    setDesktopSessionId("custom-session-abc");
    appendDesktopCrashLog("session.test", {});

    const written = appendFileSyncSpy.mock.calls[0][1] as string;
    const parsed = JSON.parse(written.trim()) as Record<string, unknown>;
    expect(parsed.sessionId).toBe("custom-session-abc");
  });

  it("writes an empty payload when none is provided", () => {
    appendDesktopCrashLog("no.payload");

    const written = appendFileSyncSpy.mock.calls[0][1] as string;
    const parsed = JSON.parse(written.trim()) as Record<string, unknown>;
    expect(parsed.payload).toEqual({});
  });

  it("handles circular references without throwing", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    expect(() =>
      appendDesktopCrashLog("circular.test", circular)
    ).not.toThrow();

    const written = appendFileSyncSpy.mock.calls[0][1] as string;
    const parsed = JSON.parse(written.trim()) as Record<string, unknown>;
    expect(parsed.event).toBe("circular.test");
    const payload = parsed.payload as Record<string, unknown>;
    expect(payload.a).toBe(1);
    expect(payload.self).toBe("[Circular]");
  });

  it("serializes Error objects in payload", () => {
    const err = new Error("test error");
    appendDesktopCrashLog("error.test", {
      error: err as unknown as Record<string, unknown>,
    });

    const written = appendFileSyncSpy.mock.calls[0][1] as string;
    const parsed = JSON.parse(written.trim()) as Record<string, unknown>;
    const payload = parsed.payload as Record<string, Record<string, string>>;
    expect(payload.error.name).toBe("Error");
    expect(payload.error.message).toBe("test error");
    expect(typeof payload.error.stack).toBe("string");
  });

  it("does not throw when fs operations fail", () => {
    mkdirSyncSpy.mockImplementation(() => {
      throw new Error("EACCES");
    });

    expect(() => appendDesktopCrashLog("fail.test", {})).not.toThrow();
  });

  it("writes to ~/.opensprint/desktop-crash.log path", () => {
    appendDesktopCrashLog("path.test", {});

    const filePath = appendFileSyncSpy.mock.calls[0][0] as string;
    expect(filePath).toContain(".opensprint");
    expect(filePath).toContain("desktop-crash.log");
  });
});
