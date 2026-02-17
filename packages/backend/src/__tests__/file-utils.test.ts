import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { writeJsonAtomic } from "../utils/file-utils.js";

describe("writeJsonAtomic", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opensprint-file-utils-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("writes JSON to the target file", async () => {
    const filePath = path.join(tempDir, "data.json");
    const data = { foo: "bar", count: 42 };

    await writeJsonAtomic(filePath, data);

    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(data);
  });

  it("formats JSON with 2-space indentation", async () => {
    const filePath = path.join(tempDir, "data.json");
    const data = { nested: { key: "value" } };

    await writeJsonAtomic(filePath, data);

    const raw = await fs.readFile(filePath, "utf-8");
    expect(raw).toContain("  ");
    expect(raw).toContain("\n");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(data);
  });

  it("does not leave a .tmp file after successful write", async () => {
    const filePath = path.join(tempDir, "data.json");
    const tmpPath = filePath + ".tmp";

    await writeJsonAtomic(filePath, { test: true });

    await expect(fs.access(tmpPath)).rejects.toThrow();
    await expect(fs.access(filePath)).resolves.toBeUndefined();
  });

  it("overwrites existing file", async () => {
    const filePath = path.join(tempDir, "data.json");
    await fs.writeFile(filePath, JSON.stringify({ old: true }));

    await writeJsonAtomic(filePath, { new: true });

    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({ new: true });
  });

  it("handles arrays and nested objects", async () => {
    const filePath = path.join(tempDir, "data.json");
    const data = {
      items: [1, 2, 3],
      nested: { a: 1, b: { c: 2 } },
    };

    await writeJsonAtomic(filePath, data);

    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(data);
  });

  it("throws when parent directory does not exist", async () => {
    const filePath = path.join(tempDir, "nonexistent", "subdir", "data.json");
    const data = { test: true };

    await expect(writeJsonAtomic(filePath, data)).rejects.toThrow();
  });
});
