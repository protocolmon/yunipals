export function databaseErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error))
    return null;
  const code = String(error.code);
  return /^[A-Z0-9_]{2,32}$/.test(code) ? code : null;
}

export function databaseUnavailable(error: unknown): boolean {
  const code = databaseErrorCode(error);
  if (
    code &&
    (/^08[0-9A-Z]{3}$/.test(code) ||
      [
        "57014",
        "55P03",
        "57P01",
        "57P02",
        "57P03",
        "53300",
        "ECONNREFUSED",
        "ECONNRESET",
        "ETIMEDOUT",
        "EPIPE"
      ].includes(code))
  )
    return true;
  // pg's connection acquisition failures do not carry a SQLSTATE.
  return (
    error instanceof Error &&
    /^(Connection terminated(?: unexpectedly)?|Connection ended unexpectedly|timeout exceeded when trying to connect|Connection terminated due to connection timeout|Client has encountered a connection error and is not queryable)/i.test(
      error.message
    )
  );
}
