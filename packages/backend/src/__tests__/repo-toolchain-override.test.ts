import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { mergeRepoToolchainProfileOverride } from "../services/project/repo-toolchain-override.js";
import { buildDefaultSettings } from "../services/project/project-settings-helpers.js";

describe("mergeRepoToolchainProfileOverride", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("merges .opensprint/merge-toolchain.json over stored toolchainProfile", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "repo-toolchain-"));
    dirs.push(repo);
    await fs.mkdir(path.join(repo, ".opensprint"), { recursive: true });
    await fs.writeFile(
      path.join(repo, ".opensprint", "merge-toolchain.json"),
      JSON.stringify({
        toolchainProfile: {
          mergeQualityGateCommands: ["npm run verify:merge-gates"],
        },
      }),
      "utf-8"
    );
    const base = {
      ...buildDefaultSettings(),
      toolchainProfile: { dependencyStrategy: "npm" as const },
    };
    const merged = await mergeRepoToolchainProfileOverride(repo, base);
    expect(merged.toolchainProfile?.dependencyStrategy).toBe("npm");
    expect(merged.toolchainProfile?.mergeQualityGateCommands).toEqual([
      "npm run verify:merge-gates",
    ]);
  });

  it("returns settings unchanged when override file is missing", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "repo-toolchain-miss-"));
    dirs.push(repo);
    const base = buildDefaultSettings();
    const merged = await mergeRepoToolchainProfileOverride(repo, base);
    expect(merged).toBe(base);
  });
});
