export const analyticsWalletId = /^wallet:evm:[0-9a-f]{64}$/;

export function normalizeAnalyticsWallet(address?: string | null) {
  return address && /^0x[0-9a-f]{40}$/i.test(address)
    ? address.toLowerCase()
    : null;
}

// A public namespace prevents reuse of the same digest by unrelated products.
// This is a stable pseudonym, not anonymization or proof of wallet ownership.
export async function walletAnalyticsId(
  address: string,
  environment: string
): Promise<string> {
  const wallet = normalizeAnalyticsWallet(address);
  if (!wallet) throw new Error("Invalid analytics wallet.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `yunipals:analytics:v2:${environment}:evm:${wallet}`
    )
  );
  return `wallet:evm:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}`;
}

export function analyticsCountry(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[A-Z]{2}$/.test(value) &&
    !["XX", "ZZ"].includes(value)
    ? value
    : undefined;
}

export async function fetchAnalyticsCountry(): Promise<string | undefined> {
  try {
    const response = await fetch("/api/analytics-country", {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(2000)
    });
    if (!response.ok) return;
    const body: unknown = await response.json();
    return body && typeof body === "object"
      ? analyticsCountry((body as Record<string, unknown>).country)
      : undefined;
  } catch {
    return undefined;
  }
}
