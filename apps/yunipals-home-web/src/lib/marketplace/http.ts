import { MarketApiError } from "@/lib/marketplace/marketApiError";

export function createMarketRequest(
  baseUrl: string,
  fetcher: typeof fetch = fetch
) {
  const url = new URL(baseUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  ) {
    throw new Error(
      "Marketplace URL must use HTTPS or local development HTTP."
    );
  }
  const base = url.href.replace(/\/$/, "");
  async function request(path: string, init: RequestInit = {}) {
    // Unified preparation has a 12-second server deadline. Legacy trade
    // endpoints retain their longer deadline for already-open clients.
    const timeoutMs =
      init.method === "POST" && /\/(preflight|fulfillment)$/.test(path)
        ? 50_000
        : 15_000;
    const response = await fetcher(`${base}${path}`, {
      ...init,
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {})
      }
    });
    if (!response.ok) throw new MarketApiError(response.status);
    // Enforce a response bound even when Content-Length is omitted or inaccurate.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Marketplace returned an empty response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 1_048_576)
          throw new Error("Marketplace response is too large.");
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  }
  return request;
}
