import { describe, it, expect } from "vitest";
import { getRunInstructions } from "./runInstructions";

describe("getRunInstructions", () => {
  it("returns pushd + npm run web for native Windows runtimes", () => {
    expect(
      getRunInstructions("C:\\Users\\Todd\\My App", {
        platform: "win32",
        isWsl: false,
        wslDistroName: null,
        repoPathPolicy: "any",
      })
    ).toEqual(['pushd "C:\\Users\\Todd\\My App"', "npm run web"]);
  });

  it("returns cd + npm run web for WSL runtimes even when the user is on Windows", () => {
    expect(
      getRunInstructions("/home/todd/My App", {
        platform: "linux",
        isWsl: true,
        wslDistroName: "Ubuntu",
        repoPathPolicy: "linux_fs_only",
      })
    ).toEqual(['cd "/home/todd/My App"', "npm run web"]);
  });

  it("returns cd + npm run web for macOS paths with spaces", () => {
    expect(
      getRunInstructions("/Users/todd/My App", {
        platform: "darwin",
        isWsl: false,
        wslDistroName: null,
        repoPathPolicy: "any",
      })
    ).toEqual(['cd "/Users/todd/My App"', "npm run web"]);
  });

  it("returns cd + npm run web for native Linux runtimes", () => {
    expect(
      getRunInstructions("/workspace/My App", {
        platform: "linux",
        isWsl: false,
        wslDistroName: null,
        repoPathPolicy: "any",
      })
    ).toEqual(['cd "/workspace/My App"', "npm run web"]);
  });

  it("never includes shell chaining", () => {
    const commands = getRunInstructions("C:\\Users\\Todd\\My App", {
      platform: "win32",
      isWsl: false,
      wslDistroName: null,
      repoPathPolicy: "any",
    });
    expect(commands.join("\n")).not.toContain("&&");
  });

  it("returns only cd for empty template on Linux", () => {
    expect(
      getRunInstructions(
        "/workspace/my-project",
        { platform: "linux", isWsl: false, wslDistroName: null, repoPathPolicy: "any" },
        "empty"
      )
    ).toEqual(['cd "/workspace/my-project"']);
  });

  it("returns only pushd for empty template on native Windows", () => {
    expect(
      getRunInstructions(
        "C:\\Users\\Todd\\my-project",
        { platform: "win32", isWsl: false, wslDistroName: null, repoPathPolicy: "any" },
        "empty"
      )
    ).toEqual(['pushd "C:\\Users\\Todd\\my-project"']);
  });

  it("returns only cd for empty template on WSL", () => {
    expect(
      getRunInstructions(
        "/home/todd/my-project",
        {
          platform: "linux",
          isWsl: true,
          wslDistroName: "Ubuntu",
          repoPathPolicy: "linux_fs_only",
        },
        "empty"
      )
    ).toEqual(['cd "/home/todd/my-project"']);
  });

  it("returns cd + npm run web for web-app-expo-react template (explicit)", () => {
    expect(
      getRunInstructions(
        "/workspace/my-app",
        { platform: "linux", isWsl: false, wslDistroName: null, repoPathPolicy: "any" },
        "web-app-expo-react"
      )
    ).toEqual(['cd "/workspace/my-app"', "npm run web"]);
  });
});
