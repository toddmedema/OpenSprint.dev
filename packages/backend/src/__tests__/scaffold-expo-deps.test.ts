import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execMock = vi.fn();

vi.mock("child_process", () => ({
  exec: (...args: unknown[]) => execMock(...args),
}));

describe("ensureExpoReactTypeDevDependencies", () => {
  let tmp: string;

  beforeEach(async () => {
    execMock.mockReset();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "opensprint-scaffold-deps-"));
    execMock.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      const callback = (typeof opts === "function" ? opts : cb) as (
        err: Error | null,
        stdout?: string,
        stderr?: string
      ) => void;
      if (typeof cmd === "string" && cmd.includes("expo install")) {
        callback(null, "", "");
        return undefined;
      }
      callback(new Error(`unexpected exec: ${cmd}`));
      return undefined;
    });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("no-ops when package.json has no react dependency", async () => {
    const { ensureExpoReactTypeDevDependencies } = await import("../utils/scaffold-expo-deps.js");
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "x", dependencies: {} })
    );
    await ensureExpoReactTypeDevDependencies(tmp);
    expect(execMock).not.toHaveBeenCalled();
  });

  it("no-ops when @types/react and @types/react-dom are present", async () => {
    const { ensureExpoReactTypeDevDependencies } = await import("../utils/scaffold-expo-deps.js");
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({
        name: "x",
        dependencies: { react: "18.2.0" },
        devDependencies: { "@types/react": "~18.2.0", "@types/react-dom": "~18.2.0" },
      })
    );
    await ensureExpoReactTypeDevDependencies(tmp);
    expect(execMock).not.toHaveBeenCalled();
  });

  it("runs expo install when react is present but typings are missing", async () => {
    const { ensureExpoReactTypeDevDependencies } = await import("../utils/scaffold-expo-deps.js");
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({
        name: "x",
        dependencies: { react: "18.2.0" },
        devDependencies: { typescript: "~5.3.0" },
      })
    );
    await ensureExpoReactTypeDevDependencies(tmp);
    expect(execMock).toHaveBeenCalledOnce();
    const call = execMock.mock.calls[0];
    expect(call[0]).toContain("expo install");
    expect(call[0]).toContain("@types/react");
    expect((call[1] as { cwd: string }).cwd).toBe(tmp);
  });
});

describe("ensureExpoLintMergeGateTooling", () => {
  let tmp: string;

  beforeEach(async () => {
    execMock.mockReset();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "opensprint-scaffold-lint-"));
    execMock.mockImplementation((cmd: string, opts: unknown, cb?: unknown) => {
      const callback = (typeof opts === "function" ? opts : cb) as (
        err: Error | null,
        stdout?: string,
        stderr?: string
      ) => void;
      if (typeof cmd === "string" && cmd.includes("expo install")) {
        callback(null, "", "");
        return undefined;
      }
      callback(new Error(`unexpected exec: ${cmd}`));
      return undefined;
    });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("installs eslint packages, writes flat eslint.config.js, and adds lint script", async () => {
    const { ensureExpoLintMergeGateTooling } = await import("../utils/scaffold-expo-deps.js");
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "x", version: "1.0.0", scripts: { start: "expo start" } })
    );
    await ensureExpoLintMergeGateTooling(tmp);
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock.mock.calls[0][0]).toContain("expo install");
    expect(execMock.mock.calls[0][0]).toContain("eslint-config-expo");
    const eslintPath = path.join(tmp, "eslint.config.js");
    const content = await fs.readFile(eslintPath, "utf-8");
    expect(content).toContain("eslint-config-expo/flat");
    const pkg = JSON.parse(await fs.readFile(path.join(tmp, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.lint).toBe("expo lint");
    expect(pkg.scripts.start).toBe("expo start");
  });

  it("does not overwrite existing eslint.config.js", async () => {
    const { ensureExpoLintMergeGateTooling } = await import("../utils/scaffold-expo-deps.js");
    await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ name: "x" }));
    await fs.writeFile(path.join(tmp, "eslint.config.js"), "// custom\n");
    await ensureExpoLintMergeGateTooling(tmp);
    expect(await fs.readFile(path.join(tmp, "eslint.config.js"), "utf-8")).toBe("// custom\n");
  });
});
