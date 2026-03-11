import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { ensureEasProjectIdInAppJson } from "../utils/eas-project-link.js";

describe("deliver EAS project linking", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "deliver-eas-project-link-"));
  });

  it("writes expo.extra.eas.projectId into app.json when missing", async () => {
    await fs.writeFile(
      path.join(tempDir, "app.json"),
      JSON.stringify({
        expo: {
          name: "Demo",
          slug: "demo",
          extra: { featureFlag: true },
        },
      })
    );

    const result = await ensureEasProjectIdInAppJson(tempDir, "project-123");
    expect(result).toEqual({ ok: true, status: "linked" });

    const appJson = JSON.parse(await fs.readFile(path.join(tempDir, "app.json"), "utf-8"));
    expect(appJson.expo.name).toBe("Demo");
    expect(appJson.expo.extra.featureFlag).toBe(true);
    expect(appJson.expo.extra.eas.projectId).toBe("project-123");
  });

  it("does not overwrite an existing projectId", async () => {
    await fs.writeFile(
      path.join(tempDir, "app.json"),
      JSON.stringify({
        expo: {
          extra: {
            eas: { projectId: "existing-id" },
          },
        },
      })
    );

    const result = await ensureEasProjectIdInAppJson(tempDir, "new-id");
    expect(result).toEqual({ ok: true, status: "already-linked" });

    const appJson = JSON.parse(await fs.readFile(path.join(tempDir, "app.json"), "utf-8"));
    expect(appJson.expo.extra.eas.projectId).toBe("existing-id");
  });

  it("returns APP_JSON_MISSING when app.json is absent", async () => {
    const result = await ensureEasProjectIdInAppJson(tempDir, "project-123");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("APP_JSON_MISSING");
    }
  });

  it("returns INVALID_APP_JSON for malformed app.json", async () => {
    await fs.writeFile(path.join(tempDir, "app.json"), "{ invalid");
    const result = await ensureEasProjectIdInAppJson(tempDir, "project-123");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_APP_JSON");
    }
  });
});
