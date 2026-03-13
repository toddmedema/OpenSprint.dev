import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { getExpoConfigStatus, ensureExpoConfig } from "../expo-config.js";

describe("expo-config", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "expo-config-test-"));
  });

  describe("getExpoConfigStatus", () => {
    it("returns not configured when no app.json exists", async () => {
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "test", dependencies: { expo: "^52.0.0" } })
      );
      const status = await getExpoConfigStatus(tempDir);
      expect(status.configured).toBe(false);
      expect(status.reason).toContain("No app.json");
    });

    it("returns configured when app.json has name and slug", async () => {
      await fs.writeFile(
        path.join(tempDir, "app.json"),
        JSON.stringify({
          expo: {
            name: "My App",
            slug: "my-app",
            version: "1.0.0",
          },
        })
      );
      const status = await getExpoConfigStatus(tempDir);
      expect(status.configured).toBe(true);
      expect(status.configPath).toContain("app.json");
    });

    it("returns not configured when app.json has empty name", async () => {
      await fs.writeFile(
        path.join(tempDir, "app.json"),
        JSON.stringify({
          expo: {
            name: "",
            slug: "my-app",
          },
        })
      );
      const status = await getExpoConfigStatus(tempDir);
      expect(status.configured).toBe(false);
      expect(status.reason).toContain("name");
    });

    it("returns not configured when app.json has no expo block", async () => {
      await fs.writeFile(path.join(tempDir, "app.json"), JSON.stringify({ someOtherKey: "value" }));
      const status = await getExpoConfigStatus(tempDir);
      expect(status.configured).toBe(false);
      expect(status.reason).toContain("expo");
    });

    it("returns configured when app.config.js exists", async () => {
      await fs.writeFile(path.join(tempDir, "app.config.js"), "module.exports = { expo: {} };");
      const status = await getExpoConfigStatus(tempDir);
      expect(status.configured).toBe(true);
      expect(status.configPath).toContain("app.config.js");
    });

    it("returns configured when app.config.ts exists", async () => {
      await fs.writeFile(path.join(tempDir, "app.config.ts"), "export default { expo: {} };");
      const status = await getExpoConfigStatus(tempDir);
      expect(status.configured).toBe(true);
      expect(status.configPath).toContain("app.config.ts");
    });
  });

  describe("ensureExpoConfig", () => {
    it("creates app.json when missing and populates from project name", async () => {
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "test-pkg", version: "2.0.0" })
      );
      const emit = () => {};
      const result = await ensureExpoConfig(tempDir, "My Cool Project", emit);
      expect(result).toEqual({ ok: true });

      const content = await fs.readFile(path.join(tempDir, "app.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.expo.name).toBe("My Cool Project");
      expect(parsed.expo.slug).toBe("my-cool-project");
      expect(parsed.expo.version).toBe("2.0.0");
    });

    it("uses package.json version when available", async () => {
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "pkg", version: "3.1.4" })
      );
      const result = await ensureExpoConfig(tempDir, "App", () => {});
      expect(result).toEqual({ ok: true });

      const content = await fs.readFile(path.join(tempDir, "app.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.expo.version).toBe("3.1.4");
    });

    it("updates existing app.json when name/slug are missing", async () => {
      await fs.writeFile(
        path.join(tempDir, "app.json"),
        JSON.stringify({
          expo: {
            slug: "",
          },
        })
      );
      await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({ version: "1.0.0" }));

      const result = await ensureExpoConfig(tempDir, "Open Sprint Demo", () => {});
      expect(result).toEqual({ ok: true });

      const content = await fs.readFile(path.join(tempDir, "app.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.expo.name).toBe("Open Sprint Demo");
      expect(parsed.expo.slug).toBe("open-sprint-demo");
      expect(parsed.expo.version).toBe("1.0.0");
    });

    it("preserves existing expo fields when already set", async () => {
      await fs.writeFile(
        path.join(tempDir, "app.json"),
        JSON.stringify({
          expo: {
            name: "Existing Name",
            slug: "existing-slug",
            version: "5.0.0",
          },
        })
      );
      const result = await ensureExpoConfig(tempDir, "New Project", () => {});
      expect(result).toEqual({ ok: true });

      const content = await fs.readFile(path.join(tempDir, "app.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.expo.name).toBe("Existing Name");
      expect(parsed.expo.slug).toBe("existing-slug");
      expect(parsed.expo.version).toBe("5.0.0");
    });

    it("slugifies project name correctly", async () => {
      await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({ version: "1.0.0" }));
      await ensureExpoConfig(tempDir, "My App & Co.!", () => {});

      const content = await fs.readFile(path.join(tempDir, "app.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.expo.slug).toBe("my-app-co");
    });

    it("calls emit when configuring", async () => {
      await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({ version: "1.0.0" }));
      const emitted: string[] = [];
      const emit = (chunk: string) => emitted.push(chunk);
      await ensureExpoConfig(tempDir, "Test", emit);
      expect(emitted.some((s) => s.includes("Configuring Expo app"))).toBe(true);
    });

    it("returns ok: true for app.config.js without modifying", async () => {
      await fs.writeFile(
        path.join(tempDir, "app.config.js"),
        "module.exports = { expo: { name: 'x', slug: 'x' } };"
      );
      const result = await ensureExpoConfig(tempDir, "Project", () => {});
      expect(result).toEqual({ ok: true });
      // Should not create app.json
      const appJsonExists = await fs
        .access(path.join(tempDir, "app.json"))
        .then(() => true)
        .catch(() => false);
      expect(appJsonExists).toBe(false);
    });

    it("returns ok: false when app.json exists but is invalid JSON", async () => {
      await fs.writeFile(path.join(tempDir, "app.json"), "{ invalid json");
      const result = await ensureExpoConfig(tempDir, "Project", () => {});
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error).toContain("could not be parsed");
      }
    });
  });
});
