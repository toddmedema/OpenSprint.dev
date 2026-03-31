import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createLogger, resetLogLevelCache, setLogSessionId } from "../utils/logger.js";

/**
 * Match the structured log format: `TIMESTAMP LEVEL [namespace] message {context}`
 * Timestamp is ISO-8601, level is 5-char padded (e.g. "INFO ", "WARN ").
 */
function logPattern(level: string, namespace: string, msgAndCtx: string): RegExp {
  const ts = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z";
  return new RegExp(`^${ts} ${level}\\s+\\[${namespace}\\] ${escapeRegex(msgAndCtx)}$`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("createLogger", () => {
  const originalEnv = process.env.LOG_LEVEL;
  const originalFmt = process.env.LOG_FORMAT;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.LOG_FORMAT;
    resetLogLevelCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.LOG_LEVEL = originalEnv;
    process.env.LOG_FORMAT = originalFmt;
    setLogSessionId(undefined as unknown as string);
    resetLogLevelCache();
  });

  it("prefixes messages with timestamp, level, and [namespace]", () => {
    process.env.LOG_LEVEL = "info";
    const log = createLogger("orchestrator");
    log.info("Test message");
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toMatch(logPattern("INFO", "orchestrator", "Test message"));
  });

  it("appends context as JSON when provided", () => {
    process.env.LOG_LEVEL = "info";
    const log = createLogger("plan");
    log.info("Task created", { taskId: "bd-a3f8.1", projectId: "proj-1" });
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toMatch(logPattern(
      "INFO",
      "plan",
      'Task created {"taskId":"bd-a3f8.1","projectId":"proj-1"}'
    ));
  });

  it("does not append empty context", () => {
    process.env.LOG_LEVEL = "info";
    const log = createLogger("feedback");
    log.info("No context", {});
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toMatch(logPattern("INFO", "feedback", "No context"));
  });

  it("warn uses console.warn", () => {
    process.env.LOG_LEVEL = "warn";
    resetLogLevelCache();
    const log = createLogger("orchestrator");
    log.warn("Warning message", { code: 42 });
    const output = (console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toMatch(logPattern("WARN", "orchestrator", 'Warning message {"code":42}'));
  });

  it("error uses console.error", () => {
    const log = createLogger("crash-recovery");
    log.error("Failed", { err: "something broke" });
    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toMatch(logPattern("ERROR", "crash-recovery", 'Failed {"err":"something broke"}'));
  });

  it("debug uses console.log when LOG_LEVEL=debug", () => {
    process.env.LOG_LEVEL = "debug";
    resetLogLevelCache();
    const log = createLogger("test");
    log.debug("Debug message");
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toMatch(logPattern("DEBUG", "test", "Debug message"));
  });

  it("debug is suppressed when LOG_LEVEL=info", () => {
    process.env.LOG_LEVEL = "info";
    resetLogLevelCache();
    const log = createLogger("test");
    log.debug("Debug message");
    expect(console.log).not.toHaveBeenCalled();
  });

  it("info is suppressed when LOG_LEVEL=warn", () => {
    process.env.LOG_LEVEL = "warn";
    resetLogLevelCache();
    const log = createLogger("test");
    log.info("Info message");
    log.warn("Warn message");
    expect(console.log).not.toHaveBeenCalled();
    const output = (console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toMatch(logPattern("WARN", "test", "Warn message"));
  });

  it("warn and error are suppressed when LOG_LEVEL=error", () => {
    process.env.LOG_LEVEL = "error";
    resetLogLevelCache();
    const log = createLogger("test");
    log.info("Info");
    log.warn("Warn");
    log.error("Error");
    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toMatch(logPattern("ERROR", "test", "Error"));
  });

  it("handles invalid LOG_LEVEL by defaulting to info", () => {
    process.env.LOG_LEVEL = "invalid";
    resetLogLevelCache();
    const log = createLogger("test");
    log.debug("Debug");
    log.info("Info");
    expect(console.log).toHaveBeenCalledTimes(1);
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toMatch(logPattern("INFO", "test", "Info"));
  });

  it("does not throw for circular context objects", () => {
    process.env.LOG_LEVEL = "info";
    resetLogLevelCache();
    const log = createLogger("test");
    const ctx: { self?: unknown; taskId: string } = { taskId: "os-1234" };
    ctx.self = ctx;
    expect(() => log.info("Circular context", ctx)).not.toThrow();
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toMatch(logPattern(
      "INFO",
      "test",
      'Circular context {"taskId":"os-1234","self":"[Circular]"}'
    ));
  });

  it("serializes bigint values in context", () => {
    process.env.LOG_LEVEL = "info";
    resetLogLevelCache();
    const log = createLogger("test");
    log.info("Bigint context", { count: 12n });
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toMatch(logPattern("INFO", "test", 'Bigint context {"count":"12n"}'));
  });

  it("includes sessionId when set", () => {
    process.env.LOG_LEVEL = "info";
    resetLogLevelCache();
    setLogSessionId("test-session-abc");
    const log = createLogger("test");
    log.info("With session");
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(output).toContain("sid=test-session-abc");
    expect(output).toContain("[test] With session");
  });

  describe("LOG_FORMAT=json", () => {
    it("outputs JSON lines when LOG_FORMAT=json", () => {
      process.env.LOG_LEVEL = "info";
      process.env.LOG_FORMAT = "json";
      resetLogLevelCache();
      const log = createLogger("plan");
      log.info("Task created", { taskId: "os-1234" });
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      const parsed = JSON.parse(output) as Record<string, unknown>;
      expect(parsed).toMatchObject({
        level: "INFO",
        ns: "plan",
        msg: "Task created",
        taskId: "os-1234",
      });
      expect(typeof parsed.ts).toBe("string");
    });

    it("includes sessionId in JSON output when set", () => {
      process.env.LOG_LEVEL = "info";
      process.env.LOG_FORMAT = "json";
      resetLogLevelCache();
      setLogSessionId("json-session-xyz");
      const log = createLogger("test");
      log.warn("Warning");
      const output = (console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      const parsed = JSON.parse(output) as Record<string, unknown>;
      expect(parsed).toMatchObject({
        level: "WARN",
        ns: "test",
        msg: "Warning",
        sessionId: "json-session-xyz",
      });
    });
  });
});
