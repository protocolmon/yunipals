import { createHash } from "node:crypto";

/** Canonical JSON for already-serialized source data (BSON uses canonical EJSON). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new Error("Non-finite or imprecise source number; encode it as a string or canonical EJSON");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new Error("Source must contain only explicit JSON values");
}

export function contentHash(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function assetKey(family: string, id: string) {
  if (!family || !id) throw new Error("Missing asset family or ID");
  return contentHash(["legacy-nft", family, id]);
}

export function archiveReleaseId(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value)) throw new Error("Invalid archive release ID");
  return value;
}
