export class MetadataHttpError extends Error {
  constructor(readonly status: number) {
    super(`Metadata HTTP ${status}`);
  }
}

// Repeated absence is different from a transient outage, but never proves that
// a document cannot appear later. Recheck weekly and requeue on metadata changes.
export function metadataRetry(error: unknown, attempts: number, previousError: string | null) {
  const missing = error instanceof MetadataHttpError && error.status === 404;
  const repeatedMissing = missing && attempts >= 3 && previousError === "Metadata HTTP 404";
  return {
    fetchStatus: repeatedMissing ? "not_found" as const : "retry" as const,
    lastError: error instanceof Error ? error.message.slice(0, 1000) : String(error),
    delaySeconds: repeatedMissing ? 7 * 86_400 : Math.min(86_400, 2 ** Math.min(attempts, 12) * 15)
  };
}
