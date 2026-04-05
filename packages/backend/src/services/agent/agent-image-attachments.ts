import fs from "fs/promises";
import os from "os";
import path from "path";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("agent-image-attachments");

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

/**
 * Parse data URL or base64 string to { media_type, data } for Anthropic image blocks.
 */
export function parseImageForClaude(img: string): {
  media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  data: string;
} {
  const VALID = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
  if (img.startsWith("data:")) {
    const match = img.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const mt = match[1].toLowerCase();
      const media_type = VALID.includes(mt as (typeof VALID)[number])
        ? (mt as (typeof VALID)[number])
        : "image/png";
      return { media_type, data: match[2] };
    }
  }
  return { media_type: "image/png", data: img };
}

export function parseImageToBuffer(img: string): { buffer: Buffer; ext: string } {
  const { media_type, data } = parseImageForClaude(img);
  const buffer = Buffer.from(data, "base64");
  const ext = MIME_TO_EXT[media_type] ?? ".png";
  return { buffer, ext };
}

/**
 * Write image attachments to temp files and return prompt suffix + cleanup.
 * Used for Cursor/custom CLI: agent reads images via file paths in the prompt.
 * cwd: when set, files are under cwd/.opensprint/agent-images; otherwise under os.tmpdir().
 */
export async function writeImagesForCli(
  cwd: string | undefined,
  images: string[]
): Promise<{ promptSuffix: string; cleanup: () => Promise<void> }> {
  const baseDir = cwd ?? os.tmpdir();
  const imageDirName = `.opensprint/agent-images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const imageDir = path.join(baseDir, imageDirName);
  await fs.mkdir(imageDir, { recursive: true });
  const pathsForPrompt: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const { buffer, ext } = parseImageToBuffer(images[i]!);
    const name = `${i}${ext}`;
    const filePath = path.join(imageDir, name);
    await fs.writeFile(filePath, buffer);
    pathsForPrompt.push(cwd ? path.join(imageDirName, name) : filePath);
  }
  const promptSuffix =
    "\n\nAttached images (read these file paths for context):\n" + pathsForPrompt.join("\n");
  const cleanup = async () => {
    await fs.rm(imageDir, { recursive: true }).catch((err: unknown) => {
      log.warn("agent image cleanup failed", { err: err instanceof Error ? err.message : String(err) });
    });
  };
  return { promptSuffix, cleanup };
}
