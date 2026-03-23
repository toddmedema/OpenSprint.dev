import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkExpoAuth, EXPO_ACCESS_TOKEN_URL } from "../expo-auth-check.js";
import * as globalSettings from "../../services/global-settings.service.js";
import * as childProcess from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

vi.mock("../../services/global-settings.service.js");
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return { ...actual, exec: vi.fn() };
});

const execMock = vi.mocked(childProcess.exec);

describe("expo-auth-check", () => {
  let tempDir: string;
  let originalExpoToken: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "expo-auth-check-test-"));
    originalExpoToken = process.env.EXPO_TOKEN;
    vi.mocked(globalSettings.getGlobalSettings).mockResolvedValue({});
  });

  afterEach(async () => {
    process.env.EXPO_TOKEN = originalExpoToken;
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.clearAllMocks();
  });

  it("returns ok when EXPO_TOKEN is set in env", async () => {
    process.env.EXPO_TOKEN = "my-token-123";
    const result = await checkExpoAuth(tempDir);
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ expoToken: "my-token-123" });
    expect(globalSettings.getGlobalSettings).not.toHaveBeenCalled();
    expect(execMock).not.toHaveBeenCalled();
  });

  it("returns ok when projectExpoToken is provided", async () => {
    delete process.env.EXPO_TOKEN;
    vi.mocked(globalSettings.getGlobalSettings).mockResolvedValue({});
    const result = await checkExpoAuth(tempDir, { projectExpoToken: "project-token-789" });
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ expoToken: "project-token-789" });
    expect(globalSettings.getGlobalSettings).not.toHaveBeenCalled();
  });

  it("prefers EXPO_TOKEN env over projectExpoToken", async () => {
    process.env.EXPO_TOKEN = "env-wins";
    const result = await checkExpoAuth(tempDir, { projectExpoToken: "project-loses" });
    expect(result).toMatchObject({ expoToken: "env-wins" });
  });

  it("returns ok when expoToken is in global settings (legacy)", async () => {
    delete process.env.EXPO_TOKEN;
    vi.mocked(globalSettings.getGlobalSettings).mockResolvedValue({
      expoToken: "settings-token-456",
    });
    const result = await checkExpoAuth(tempDir);
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ expoToken: "settings-token-456" });
  });

  it("returns failure with explicit prompt when no token and eas whoami fails", async () => {
    delete process.env.EXPO_TOKEN;
    vi.mocked(globalSettings.getGlobalSettings).mockResolvedValue({});
    execMock.mockImplementation((cmd, opts, cb) => {
      const callback = (typeof opts === "function" ? opts : cb) as (err: Error) => void;
      if (callback) {
        setImmediate(() => callback(new Error("Not logged in")));
      }
      return {} as ReturnType<typeof childProcess.exec>;
    });

    const result = await checkExpoAuth(tempDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("EXPO_TOKEN_REQUIRED");
      expect(result.message).toContain("authentication");
      expect(result.prompt).toContain(EXPO_ACCESS_TOKEN_URL);
      expect(result.prompt).toContain("How to obtain");
      expect(result.prompt).toContain("How to provide");
    }
  });

  it.skip("returns ok when eas whoami succeeds (interactive login)", async () => {
    const prev = process.env.EXPO_TOKEN;
    delete process.env.EXPO_TOKEN;
    vi.mocked(globalSettings.getGlobalSettings).mockResolvedValue({});
    execMock.mockImplementation((command, options, callback) => {
      const cb = typeof options === "function" ? options : callback;
      if (cb) {
        process.nextTick(() => (cb as (err: null, stdout: string) => void)(null, "username\n"));
      }
      return {} as ReturnType<typeof childProcess.exec>;
    });

    const result = await checkExpoAuth(tempDir);
    process.env.EXPO_TOKEN = prev;
    expect(execMock).toHaveBeenCalledWith(
      "npx eas-cli whoami",
      expect.objectContaining({ cwd: tempDir })
    );
    expect(result.ok).toBe(true);
  });
});
