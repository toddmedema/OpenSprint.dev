/** Node.js/network codes: server unreachable */
const DB_UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

/** PostgreSQL error codes: server reachable but auth/database/config wrong */
const DB_AUTH_CONFIG_CODES = new Set([
  "28P01", // invalid_password
  "28000", // invalid_authorization_specification
  "3D000", // invalid_catalog_name (database does not exist)
  "42501", // insufficient_privilege
  "42P01", // undefined_table (schema not applied)
]);

/** SQLite error codes that indicate connection/open or config issues */
const SQLITE_CONNECTION_CODES = new Set([
  "SQLITE_CANTOPEN",
  "SQLITE_READONLY",
  "SQLITE_BUSY",
  "SQLITE_LOCKED",
  "SQLITE_IOERR",
  "SQLITE_CORRUPT",
  "SQLITE_NOTADB",
]);

function isSqliteConnectionCode(code: string): boolean {
  if (!code.startsWith("SQLITE_")) return false;
  return Array.from(SQLITE_CONNECTION_CODES).some(
    (prefix) => code === prefix || code.startsWith(`${prefix}_`)
  );
}

function getErrorCode(err: unknown): string {
  const code =
    (err as NodeJS.ErrnoException).code ??
    (err as { code?: string }).code ??
    (err as { errno?: number }).errno;
  return typeof code === "number" ? String(code) : String(code ?? "");
}

export function isDbConnectionError(err: unknown): boolean {
  const code = getErrorCode(err);
  if (DB_UNREACHABLE_CODES.has(code) || DB_AUTH_CONFIG_CODES.has(code)) {
    return true;
  }
  if (isSqliteConnectionCode(code)) {
    return true;
  }

  const msg = err instanceof Error ? err.message : String(err);
  return (
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|connection refused|getaddrinfo|connect EHOSTUNREACH|password authentication failed|role .* does not exist|database .* does not exist|permission denied|relation .* does not exist|SQLITE_CANTOPEN|SQLITE_READONLY|SQLITE_BUSY|SQLITE_LOCKED|SQLITE_IOERR|SQLITE_CORRUPT|SQLITE_NOTADB/i.test(
      msg
    )
  );
}

export function classifyDbConnectionError(
  err: unknown,
  dialect: "postgres" | "sqlite" = "postgres"
): string {
  const code = getErrorCode(err);
  const msg = err instanceof Error ? err.message : String(err);

  if (isSqliteConnectionCode(code)) {
    if (code === "SQLITE_CANTOPEN")
      return "The database file could not be opened; check that the path exists and this app has permission to access it.";
    if (code === "SQLITE_READONLY")
      return "The database file is read-only; check file permissions so OpenSprint can save data.";
    if (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED"))
      return "The database is in use or locked; wait a moment or close other programs that might be using it.";
    return "The database file could not be used; it may be corrupted or the path in settings may be wrong.";
  }

  if (DB_UNREACHABLE_CODES.has(code)) {
    return dialect === "sqlite"
      ? "The database file could not be opened; check that the path in settings exists and is writable."
      : "The database server could not be reached; make sure PostgreSQL is running and the host and port in your settings are correct.";
  }
  if (DB_AUTH_CONFIG_CODES.has(code)) {
    return "The database rejected the connection; check the username, password, and database name in your settings.";
  }
  if (
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|connection refused|getaddrinfo|connect EHOSTUNREACH/i.test(
      msg
    )
  ) {
    return dialect === "sqlite"
      ? "The database file could not be opened; check that the path in settings exists and is writable."
      : "The database server could not be reached; make sure PostgreSQL is running and the host and port in your settings are correct.";
  }
  if (
    /password authentication failed|role .* does not exist|database .* does not exist|permission denied|relation .* does not exist/i.test(
      msg
    )
  ) {
    return "The database rejected the connection; check the username, password, and database name in your settings.";
  }

  return dialect === "sqlite"
    ? "OpenSprint could not connect to the database; check the file path and permissions in your settings."
    : "OpenSprint could not connect to the database; check that the server is running and your connection settings are correct.";
}
