import { Router, Request } from "express";
import { readdir, stat, mkdir } from "fs/promises";
import { join, resolve, dirname } from "path";
import { existsSync } from "fs";
import type { ApiResponse } from "@opensprint/shared";
import { detectTestFramework } from "../services/test-framework.service.js";

export const fsRouter = Router();

interface BrowseResult {
  current: string;
  parent: string | null;
  entries: { name: string; path: string; isDirectory: boolean }[];
}

// GET /fs/browse?path=/some/path — List directory contents
fsRouter.get("/browse", async (req: Request<object, object, object, { path?: string }>, res, next) => {
  try {
    const rawPath = req.query.path;
    const targetPath = rawPath?.trim() ? resolve(rawPath) : resolve(process.env.HOME || process.env.USERPROFILE || "/");

    if (!existsSync(targetPath)) {
      res.status(400).json({
        error: { code: "NOT_FOUND", message: "Directory does not exist" },
      });
      return;
    }

    const pathStat = await stat(targetPath);
    if (!pathStat.isDirectory()) {
      res.status(400).json({
        error: { code: "NOT_DIRECTORY", message: "Path is not a directory" },
      });
      return;
    }

    const entries = await readdir(targetPath, { withFileTypes: true });
    const dirEntries = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({
        name: e.name,
        path: join(targetPath, e.name),
        isDirectory: true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    const parentPath = dirname(targetPath);
    const result: BrowseResult = {
      current: targetPath,
      parent: parentPath !== targetPath ? parentPath : null,
      entries: dirEntries,
    };

    const body: ApiResponse<BrowseResult> = { data: result };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

interface CreateFolderBody {
  parentPath: string;
  name: string;
}

// POST /fs/create-folder — Create a new folder and return its path
fsRouter.post(
  "/create-folder",
  async (req: Request<object, object, CreateFolderBody>, res, next) => {
    try {
      const { parentPath, name } = req.body ?? {};
      if (!parentPath || typeof parentPath !== "string" || !name || typeof name !== "string") {
        res.status(400).json({
          error: { code: "INVALID_INPUT", message: "parentPath and name are required" },
        });
        return;
      }
      const trimmedName = name.trim();
      if (!trimmedName || trimmedName === "." || trimmedName === "..") {
        res.status(400).json({
          error: { code: "INVALID_INPUT", message: "Invalid folder name" },
        });
        return;
      }
      if (trimmedName.includes("/") || trimmedName.includes("\\")) {
        res.status(400).json({
          error: { code: "INVALID_INPUT", message: "Folder name cannot contain path separators" },
        });
        return;
      }

      const parentResolved = resolve(parentPath);
      const newPath = join(parentResolved, trimmedName);
      if (!newPath.startsWith(parentResolved)) {
        res.status(400).json({
          error: { code: "INVALID_INPUT", message: "Invalid path" },
        });
        return;
      }

      if (!existsSync(parentResolved)) {
        res.status(400).json({
          error: { code: "NOT_FOUND", message: "Parent directory does not exist" },
        });
        return;
      }
      const parentStat = await stat(parentResolved);
      if (!parentStat.isDirectory()) {
        res.status(400).json({
          error: { code: "NOT_DIRECTORY", message: "Parent path is not a directory" },
        });
        return;
      }

      if (existsSync(newPath)) {
        res.status(409).json({
          error: { code: "ALREADY_EXISTS", message: "A file or folder with that name already exists" },
        });
        return;
      }

      await mkdir(newPath, { recursive: false });
      const body: ApiResponse<{ path: string }> = { data: { path: newPath } };
      res.json(body);
    } catch (err) {
      next(err);
    }
  },
);

// GET /fs/detect-test-framework?path=/some/path — Detect test framework from project files
fsRouter.get(
  "/detect-test-framework",
  async (req: Request<object, object, object, { path?: string }>, res, next) => {
    try {
      const rawPath = req.query.path?.trim();
      if (!rawPath) {
        res.status(400).json({
          error: { code: "INVALID_INPUT", message: "Path query parameter is required" },
        });
        return;
      }

      const targetPath = resolve(rawPath);
      if (!existsSync(targetPath)) {
        res.status(400).json({
          error: { code: "NOT_FOUND", message: "Directory does not exist" },
        });
        return;
      }

      const detected = await detectTestFramework(targetPath);
      const body: ApiResponse<{ framework: string; testCommand: string } | null> = { data: detected };
      res.json(body);
    } catch (err) {
      next(err);
    }
  },
);
