import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest, type RequestOptions } from "node:https";

import type { PreviewConfig } from "./config";

export class PreviewError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function publicAddress(address: string) {
  // Reject all non-global IPv4 ranges and mapped IPv6; only global IPv6 unicast.
  if (isIP(address) === 6)
    return (
      /^[23][0-9a-f]{3}:/i.test(address) &&
      !/^2001:(?:0:|db8:)/i.test(address) &&
      !/^2002:/i.test(address)
    );
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0)
  );
}

export function assetUrl(uri: string, config: PreviewConfig): string | null {
  try {
    const url = new URL(
      uri.startsWith("ipfs://")
        ? `${config.gateway.replace(/\/?$/, "/")}${uri.slice(7).replace(/^ipfs\//, "")}`
        : uri,
      config.siteOrigin
    );
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !config.assetHosts.includes(url.hostname)
    )
      return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export type PreviewReader = (
  url: string,
  signal: AbortSignal,
  image?: boolean
) => Promise<Buffer>;

/** Resolve and pin the socket address, including on every redirect. No ambient
 * cookies, credentials, proxy settings or automatic redirect following. */
export function createReader(config: PreviewConfig): PreviewReader {
  return async (input, signal, image = false) => {
    let current = input;
    for (let redirect = 0; redirect <= 2; redirect++) {
      const safe = assetUrl(current, config);
      if (!safe) throw new PreviewError(503, "Artwork source is unavailable.");
      const url = new URL(safe);
      signal.throwIfAborted();
      const addresses = await new Promise<import("node:dns").LookupAddress[]>(
        (resolve, reject) => {
          const abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          lookup(url.hostname, { all: true })
            .then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", abort));
        }
      );
      signal.throwIfAborted();
      if (
        !addresses.length ||
        addresses.some((row) => !publicAddress(row.address))
      )
        throw new PreviewError(503, "Artwork source is unavailable.");
      const pinned = addresses[0];
      const result = await new Promise<{
        status: number;
        location?: string;
        body: Buffer;
      }>((resolve, reject) => {
        const requestOptions: RequestOptions & { autoSelectFamily: boolean } = {
          signal,
          // Pin one vetted address; Node must not request an all-address lookup.
          autoSelectFamily: false,
          headers: {
            Accept: image
              ? "image/png,image/jpeg,image/webp"
              : "application/json"
          },
          lookup: (_host, _options, callback) =>
            callback(null, pinned.address, pinned.family)
        };
        const req = httpsRequest(url, requestOptions, (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          const max = image ? 8 * 1024 * 1024 : 512 * 1024;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > max)
              req.destroy(
                new PreviewError(503, "Preview source is too large.")
              );
            else chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 503,
              location: res.headers.location,
              body: Buffer.concat(chunks)
            })
          );
        });
        req.on("error", reject);
        req.end();
      });
      if (
        [301, 302, 303, 307, 308].includes(result.status) &&
        result.location
      ) {
        current = new URL(result.location, url).href;
        continue;
      }
      if (result.status === 404)
        throw new PreviewError(404, "Collectible not found.");
      if (result.status !== 200)
        throw new PreviewError(503, "Preview data is temporarily unavailable.");
      return result.body;
    }
    throw new PreviewError(503, "Too many artwork redirects.");
  };
}

export async function readJson(
  read: PreviewReader,
  url: string,
  signal: AbortSignal
): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse((await read(url, signal)).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PreviewError(503, "Preview data is unavailable.");
  return value as Record<string, unknown>;
}
