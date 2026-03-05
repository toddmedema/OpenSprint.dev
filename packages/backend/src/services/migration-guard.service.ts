import fs from "fs/promises";
import { AppError } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";

const MIGRATION_COMMAND = "npm run migrate:opensprint";

async function hasLegacyData(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    if (stat.isFile()) return true;
    if (!stat.isDirectory()) return false;
    const entries = await fs.readdir(path);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * Fail fast when a DB-backed resource is missing but legacy canonical files still exist.
 * This forces a one-time migration script run and avoids permanent runtime fallback paths.
 */
export async function assertMigrationCompleteForResource(opts: {
  hasDbRecord: boolean;
  resource: string;
  legacyPaths: string[];
  projectId?: string;
}): Promise<void> {
  if (opts.hasDbRecord) return;

  for (const legacyPath of opts.legacyPaths) {
    if (!(await hasLegacyData(legacyPath))) continue;

    throw new AppError(
      409,
      ErrorCodes.MIGRATION_REQUIRED,
      `${opts.resource} is still in legacy .opensprint files. Run \`${MIGRATION_COMMAND}\` once, then retry.`,
      {
        resource: opts.resource,
        legacyPath,
        migrationCommand: MIGRATION_COMMAND,
        ...(opts.projectId && { projectId: opts.projectId }),
      }
    );
  }
}
