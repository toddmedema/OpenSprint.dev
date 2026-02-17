import fs from "fs/promises";

/**
 * Atomically write JSON to a file.
 * Writes to a .tmp file first, then renames to the target path.
 * This prevents partial/corrupt writes if the process crashes mid-write.
 */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tmpPath = filePath + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmpPath, filePath);
}
