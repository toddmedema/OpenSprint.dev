import fs from "fs/promises";
import path from "path";

const APP_JSON = "app.json";

type JsonObject = Record<string, unknown>;

export type EnsureEasProjectIdInAppJsonResult =
  | { ok: true; status: "already-linked" | "linked" }
  | { ok: false; code: "APP_JSON_MISSING" | "INVALID_APP_JSON" | "APP_JSON_WRITE_FAILED"; error: string };

/**
 * Ensure app.json contains expo.extra.eas.projectId.
 * Returns APP_JSON_MISSING when app.json is absent so callers can fallback to eas init.
 */
export async function ensureEasProjectIdInAppJson(
  repoPath: string,
  easProjectId: string
): Promise<EnsureEasProjectIdInAppJsonResult> {
  const appJsonPath = path.join(repoPath, APP_JSON);
  let raw: string;

  try {
    raw = await fs.readFile(appJsonPath, "utf-8");
  } catch (err) {
    if (isMissingFileError(err)) {
      return {
        ok: false,
        code: "APP_JSON_MISSING",
        error: "app.json not found",
      };
    }
    return {
      ok: false,
      code: "INVALID_APP_JSON",
      error: `Failed to read app.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let parsed: JsonObject;
  try {
    parsed = JSON.parse(raw) as JsonObject;
  } catch (err) {
    return {
      ok: false,
      code: "INVALID_APP_JSON",
      error: `app.json is invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const root = toObject(parsed);
  const expo = toObject(root.expo) ?? {};
  const extra = toObject(expo.extra) ?? {};
  const eas = toObject(extra.eas) ?? {};

  const existingProjectId =
    typeof eas.projectId === "string" && eas.projectId.trim() ? eas.projectId : undefined;
  if (existingProjectId) {
    return { ok: true, status: "already-linked" };
  }

  const output = {
    ...root,
    expo: {
      ...expo,
      extra: {
        ...extra,
        eas: {
          ...eas,
          projectId: easProjectId,
        },
      },
    },
  };

  try {
    await fs.writeFile(appJsonPath, JSON.stringify(output, null, 2), "utf-8");
  } catch (err) {
    return {
      ok: false,
      code: "APP_JSON_WRITE_FAILED",
      error: `Failed to write app.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { ok: true, status: "linked" };
}

function toObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonObject;
}

function isMissingFileError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return "code" in err && (err as { code?: string }).code === "ENOENT";
}
