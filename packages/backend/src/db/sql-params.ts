/**
 * Convert SQLite-style ? placeholders to Postgres $1, $2, ... placeholders.
 */
export function toPgParams(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Convert Postgres $1, $2, ... placeholders to SQLite ? placeholders.
 * Also rewrites Postgres ::int cast to SQLite CAST(... AS INTEGER).
 * Params array order is unchanged.
 */
export function toSqliteParams(sql: string): string {
  let s = sql.replace(/\$\d+/g, "?");
  s = s.replace(/(\S+)::int\b/gi, "CAST($1 AS INTEGER)");
  return s;
}
