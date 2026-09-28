import { createHash } from "node:crypto";
import { canonicalJson, contentHash } from "./canonical.js";

// These fields describe the legacy ownership projection, not immutable traits.
// A difference here is still recorded; it is never evidence of current ownership.
const ownershipFields = new Set(["ownerAddress", "ownerSince", "delegateeAddress", "chain", "minted", "bridged", "optimisticChange", "ownerAddressSnapshot"]);
export function metadataInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid source envelope");
  return Object.fromEntries(Object.entries(value).filter(([key]) => !ownershipFields.has(key)));
}
export function sourceDifference(archived: unknown, current: unknown, archivedHash = contentHash(archived)) {
  if (archivedHash === contentHash(current)) return "equal";
  return contentHash(metadataInput(archived)) === contentHash(metadataInput(current)) ? "ownership_projection_changed" : "metadata_changed";
}
export function advanceSourceHash(previous: string, namespace: string, key: string, hash: string) {
  return createHash("sha256").update(canonicalJson([previous,namespace,key,hash])).digest("hex");
}
