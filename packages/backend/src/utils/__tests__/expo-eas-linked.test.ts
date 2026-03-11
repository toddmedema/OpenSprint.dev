import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { isEasProjectLinked } from "../expo-eas-linked.js";
import * as childProcess from "child_process";

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return { ...actual, exec: vi.fn() };
});

const execMock = vi.mocked(childProcess.exec);

describe("expo-eas-linked", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "expo-eas-linked-test-"));
    vi.clearAllMocks();
    execMock.mockImplementation(
      (
        _cmd: string,
        _opts: unknown,
        cb: (err: Error | null, stdout?: string, stderr?: string) => void
      ) => {
        cb(new Error("command not found"));
      }
    );
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe("isEasProjectLinked", () => {
    it("returns true when app.json has expo.extra.eas.projectId", async () => {
      await fs.writeFile(
        path.join(tempDir, "app.json"),
        JSON.stringify({
          expo: {
            name: "My App",
            extra: {
              eas: {
                projectId: "abc123-def456-ghi789",
              },
            },
          },
        })
      );
      expect(await isEasProjectLinked(tempDir)).toBe(true);
      expect(execMock).not.toHaveBeenCalled();
    });

    it("returns true when app.json has projectId at expo.extra.eas.projectId", async () => {
      await fs.writeFile(
        path.join(tempDir, "app.json"),
        JSON.stringify({
          expo: {
            extra: {
              eas: {
                projectId: "linked-project-id",
              },
            },
          },
        })
      );
      expect(await isEasProjectLinked(tempDir)).toBe(true);
    });

    it("returns false when app.json has no expo.extra.eas.projectId and eas project:info fails", async () => {
      await fs.writeFile(
        path.join(tempDir, "app.json"),
        JSON.stringify({
          expo: {
            name: "My App",
            slug: "my-app",
          },
        })
      );
      execMock.mockImplementation(
        (
          _cmd: string,
          _opts: unknown,
          cb: (err: Error | null, stdout?: string, stderr?: string) => void
        ) => {
          cb(new Error("EAS CLI not installed"));
        }
      );
      expect(await isEasProjectLinked(tempDir)).toBe(false);
    });

    it("returns true when app.json has no projectId but eas project:info succeeds", async () => {
      await fs.writeFile(
        path.join(tempDir, "app.json"),
        JSON.stringify({
          expo: {
            name: "My App",
            slug: "my-app",
          },
        })
      );
      execMock.mockImplementation(
        (
          cmd: string,
          opts: unknown,
          cb: (err: Error | null, stdout?: string, stderr?: string) => void
        ) => {
          if (cmd.includes("eas-cli project:info")) {
            cb(null, "Project ID: abc-123\n", "");
          } else {
            cb(new Error("command not found"));
          }
        }
      );
      expect(await isEasProjectLinked(tempDir)).toBe(true);
      expect(execMock).toHaveBeenCalledWith(
        "npx eas-cli project:info",
        expect.objectContaining({ cwd: tempDir, timeout: 15000 }),
        expect.any(Function)
      );
    });

    it("returns false when app.json does not exist and eas project:info fails", async () => {
      execMock.mockImplementation(
        (
          _cmd: string,
          _opts: unknown,
          cb: (err: Error | null, stdout?: string, stderr?: string) => void
        ) => {
          cb(new Error("This project is not linked to an EAS project"));
        }
      );
      expect(await isEasProjectLinked(tempDir)).toBe(false);
    });

    it("returns false when EAS CLI throws (network failure)", async () => {
      await fs.writeFile(
        path.join(tempDir, "app.json"),
        JSON.stringify({ expo: { name: "App" } })
      );
      execMock.mockImplementation(
        (
          _cmd: string,
          _opts: unknown,
          cb: (err: Error | null, stdout?: string, stderr?: string) => void
        ) => {
          cb(new Error("ENOTFOUND network timeout"));
        }
      );
      expect(await isEasProjectLinked(tempDir)).toBe(false);
    });

    it("returns false when app.json has empty projectId", async () => {
      await fs.writeFile(
        path.join(tempDir, "app.json"),
        JSON.stringify({
          expo: {
            extra: {
              eas: {
                projectId: "",
              },
            },
          },
        })
      );
      execMock.mockImplementation(
        (
          _cmd: string,
          _opts: unknown,
          cb: (err: Error | null, stdout?: string, stderr?: string) => void
        ) => {
          cb(new Error("not linked"));
        }
      );
      expect(await isEasProjectLinked(tempDir)).toBe(false);
    });

    it("returns false when app.json is invalid JSON", async () => {
      await fs.writeFile(path.join(tempDir, "app.json"), "{ invalid json");
      execMock.mockImplementation(
        (
          _cmd: string,
          _opts: unknown,
          cb: (err: Error | null, stdout?: string, stderr?: string) => void
        ) => {
          cb(new Error("not linked"));
        }
      );
      expect(await isEasProjectLinked(tempDir)).toBe(false);
    });

    it("falls through to eas project:info when expo config fails for app.config.js", async () => {
      await fs.writeFile(
        path.join(tempDir, "app.config.js"),
        "module.exports = { expo: {} };"
      );
      execMock.mockImplementation(
        (
          cmd: string,
          opts: unknown,
          cb: (err: Error | null, stdout?: string, stderr?: string) => void
        ) => {
          if (cmd.includes("expo config")) {
            cb(new Error("expo not installed"), "", "");
          } else if (cmd.includes("eas-cli project:info")) {
            cb(null, "Project ID: xyz\n", "");
          } else {
            cb(new Error("command not found"));
          }
        }
      );
      expect(await isEasProjectLinked(tempDir)).toBe(true);
    });
  });
});
