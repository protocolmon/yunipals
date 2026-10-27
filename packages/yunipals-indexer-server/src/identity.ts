import { createHash } from "node:crypto";
import {
  validateSourceManifest,
  type SourceManifest
} from "../../yunipals-indexer-client/src/sources.js";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined)
    throw new Error("Manifest contains a non-JSON value.");
  return encoded;
}

export function manifestDigest(value: unknown): string {
  return `0x${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

export function sourceManifestHash(manifest: SourceManifest): string {
  validateSourceManifest(manifest);
  return manifestDigest({
    ...manifest,
    sources: [...manifest.sources].sort((a, b) => a.id.localeCompare(b.id))
  });
}

export function transactionEvidenceHash(
  receipt: unknown,
  block: unknown
): string {
  return manifestDigest({ receipt, block });
}
