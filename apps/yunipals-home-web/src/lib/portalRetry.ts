export class PortalRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number
  ) {
    super(message);
    this.name = "PortalRequestError";
  }
}

export function portalRetryAfter(value: string | null, now = Date.now()) {
  if (!value) return 0;
  const delay = /^\d+$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}
