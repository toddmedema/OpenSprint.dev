/**
 * SQLite DbClient implementation using better-sqlite3.
 * Converts $1, $2 placeholders to ? and strips Postgres ::type casts for compatibility.
 */

import fs from "fs/promises";
import path from "path";
import type { DbClient, DbRow } from "./client.js";
import { databaseRuntime } from "../services/database-runtime.service.js";
import { AppError } from "../middleware/error-handler.js";
import { ErrorCodes } from "../middleware/error-codes.js";
import { classifyDbConnectionError, isDbConnectionError } from "./db-errors.js";

/** Convert Postgres $1, $2 placeholders to SQLite ? and return params in order. */
function toSqliteSqlAndParams(sql: string, params: unknown[] = []): { sql: string; params: unknown[] } {
  let out = sql.replace(/\$(\d+)/g, "?");
  // Strip Postgres ::type casts so the same SQL works on both (e.g. COUNT(*)::int)
  out = out.replace(/::(int|integer|bigint|text)\b/gi, "");
  return { sql: out, params };
}

function runAsync<T>(fn: () => T | Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      Promise.resolve(fn())
        .then(resolve)
        .catch(reject);
    });
  });
}

function rethrowDatabaseError(err: unknown): never {
  if (err instanceof AppError && err.code === ErrorCodes.DATABASE_UNAVAILABLE) {
    throw err;
  }
  if (isDbConnectionError(err)) {
    databaseRuntime.handleOperationalFailure(err);
    throw new AppError(
      503,
      ErrorCodes.DATABASE_UNAVAILABLE,
      classifyDbConnectionError(err, "sqlite")
    );
  }
  throw err;
}

async function withErrorHandling<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    rethrowDatabaseError(err);
  }
}

/**
 * Resolve a SQLite database URL or path to an absolute file path.
 * Accepts: sqlite:///path, file:///path, or bare path (relative or absolute).
 */
export function resolveSqlitePath(databaseUrl: string): string {
  const trimmed = databaseUrl.trim();
  if (
    trimmed === ":memory:" ||
    trimmed === "sqlite://:memory:" ||
    trimmed === "sqlite:///:memory:" ||
    trimmed === "file::memory:" ||
    trimmed === "file://:memory:" ||
    trimmed === "file:///:memory:"
  ) {
    return ":memory:";
  }
  if (/^sqlite:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const p = u.pathname || u.hostname || "";
      const decoded = decodeURIComponent(p.replace(/^\//, ""));
      if (decoded === ":memory:") return ":memory:";
      return path.resolve(decoded);
    } catch {
      return path.resolve(trimmed.replace(/^sqlite:\/\/\/?/i, ""));
    }
  }
  if (/^file:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const decoded = decodeURIComponent(u.pathname);
      if (decoded === ":memory:" || decoded === "/:memory:") return ":memory:";
      return path.resolve(decoded);
    } catch {
      return path.resolve(trimmed.replace(/^file:\/\/\/?/i, ""));
    }
  }
  return path.resolve(trimmed);
}

/**
 * Open a SQLite database from URL/path. Ensures parent directory exists.
 * Returns the Database instance and a close function.
 */
export async function openSqliteDatabase(
  databaseUrl: string
): Promise<{ db: import("better-sqlite3").Database; close: () => void }> {
  const absPath = resolveSqlitePath(databaseUrl);
  if (absPath !== ":memory:") {
    const dir = path.dirname(absPath);
    await fs.mkdir(dir, { recursive: true });
  }
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(absPath);
  if (absPath !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  return {
    db,
    close: () => {
      db.close();
    },
  };
}

/**
 * Create a DbClient backed by a better-sqlite3 Database.
 * Sync better-sqlite3 calls are run in setImmediate to avoid blocking the event loop.
 */
export function createSqliteDbClient(db: import("better-sqlite3").Database): DbClient {
  const runQuery = (sql: string, params: unknown[]): DbRow[] => {
    const { sql: s, params: p } = toSqliteSqlAndParams(sql, params);
    const stmt = db.prepare(s);
    if (stmt.reader) {
      return stmt.all(...p) as DbRow[];
    }
    stmt.run(...p);
    return [];
  };

  const runExecute = (sql: string, params: unknown[]): number => {
    const { sql: s, params: p } = toSqliteSqlAndParams(sql, params);
    const result = db.prepare(s).run(...p);
    return result.changes;
  };

  return {
    async query(sql: string, params?: unknown[]): Promise<DbRow[]> {
      return withErrorHandling(async () =>
        runAsync(() => runQuery(sql, params ?? []))
      );
    },
    async queryOne(sql: string, params?: unknown[]): Promise<DbRow | undefined> {
      return withErrorHandling(async () =>
        runAsync(() => {
          const rows = runQuery(sql, params ?? []);
          return rows.length > 0 ? rows[0] : undefined;
        })
      );
    },
    async execute(sql: string, params?: unknown[]): Promise<number> {
      return withErrorHandling(async () =>
        runAsync(() => runExecute(sql, params ?? []))
      );
    },
    async runInTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
      return withErrorHandling(async () =>
        runAsync(async () => {
          db.exec("BEGIN");
          try {
            const txClient: DbClient = {
              query: (s, p) => Promise.resolve(runQuery(s, p ?? [])),
              queryOne: (s, p) =>
                Promise.resolve(
                  (() => {
                    const rows = runQuery(s, p ?? []);
                    return rows.length > 0 ? rows[0] : undefined;
                  })()
                ),
              execute: (s, p) => Promise.resolve(runExecute(s, p ?? [])),
              runInTransaction: (nestedFn) => nestedFn(txClient),
            };
            const result = await fn(txClient);
            db.exec("COMMIT");
            return result;
          } catch (err) {
            db.exec("ROLLBACK");
            throw err;
          }
        })
      );
    },
  };
}
