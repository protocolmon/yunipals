import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { promises as dns } from "node:dns";
import { z } from "zod";
import { MetadataHttpError } from "./retry.js";

const metadataSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
  animation_url: z.string().optional(),
  attributes: z.array(z.record(z.unknown())).optional()
}).passthrough();

function isPrivateIp(address: string) {
  if (address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  if (!isIP(address)) return true;
  const octets = address.split(".").map(Number);
  return isIP(address) === 4 && (
    octets[0] === 10 || octets[0] === 127 || octets[0] === 0 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export async function fetchMetadata(uri: string, options: { maxBytes: number; allowedHosts: Set<string> }) {
  const url = new URL(uri);
  if (url.protocol !== "https:") throw new Error("Only HTTPS metadata URLs are allowed");
  if (!options.allowedHosts.has(url.hostname)) throw new Error(`Metadata host is not allowlisted: ${url.hostname}`);
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (addresses.some(({ address }) => isPrivateIp(address))) throw new Error("Metadata host resolved to a private address");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "error", headers: { accept: "application/json" } });
    if (!response.ok) throw new MetadataHttpError(response.status);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > options.maxBytes) throw new Error("Metadata payload is too large");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > options.maxBytes) throw new Error("Metadata payload is too large");
    const raw = new TextDecoder().decode(bytes);
    const document = metadataSchema.parse(JSON.parse(raw));
    return {
      document,
      contentHash: createHash("sha256").update(bytes).digest("hex")
    };
  } finally {
    clearTimeout(timeout);
  }
}
