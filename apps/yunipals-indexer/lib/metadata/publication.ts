import { z } from "zod";
import { contentHash } from "./source/canonical.js";

export type MetadataDocument = Record<string, unknown>;
export type MetadataVariant = "public" | "internal" | "legacy-factory";
export type PublicationStatus = "published" | "unavailable" | "reconciliation_required" | "retry";
export class MetadataUnavailable extends Error {
  constructor(public readonly reason: string, public readonly status: PublicationStatus = "unavailable") {
    super(reason); this.name = "MetadataUnavailable";
  }
}
export function metadataSourceMode(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.METADATA_SOURCE_MODE ?? "legacy-http";
  if (mode !== "legacy-http" && mode !== "archive") throw new Error("Invalid METADATA_SOURCE_MODE");
  return mode;
}
const documentSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), description: z.string(),
  attributes: z.array(z.object({ trait_type: z.string(), value: z.unknown() }).passthrough()),
  image: z.string().optional(), animation_url: z.string().optional()
}).passthrough();
export function validateMetadata(value: unknown): MetadataDocument {
  const result = documentSchema.safeParse(value);
  // Some existing Ghost Portals have no media URLs. Their names/traits are still
  // valid historical metadata; media coverage is audited separately.
  if (!result.success) throw new MetadataUnavailable("invalid_metadata_document");
  return result.data;
}
// Volatile owner state is applied by the read layer, never baked into revisions.
export function immutableMetadata(document: MetadataDocument) {
  const { address: _address, ownerSince: _since, minted: _minted, ...stable } = document;
  return stable;
}
export function publicationHash(document: MetadataDocument) { return contentHash(immutableMetadata(document)); }
export function metadataError(error: unknown): MetadataUnavailable {
  if (error instanceof MetadataUnavailable) return error;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (["source_missing","parent_missing","source_invalid","alias_ambiguous"].includes(code)) return new MetadataUnavailable(code);
  if (code === "archive_unavailable") return new MetadataUnavailable(code, "retry");
  if (error instanceof Error && ["existing_asset_binding_conflict","existing_lifecycle_binding_conflict","unverified_source",
    "conflicting_batch_binding","unsupported_metadata_uri","unsupported_metadata_id","collection_mismatch"].includes(error.message)) {
    return new MetadataUnavailable(error.message,"reconciliation_required");
  }
  if (error instanceof z.ZodError) return new MetadataUnavailable("source_invalid");
  return new MetadataUnavailable("publication_failed", "retry");
}

/** Keep legacy mode operational before migration; archive mode never counts HTTP evidence. */
export function publicationAvailableSql(alias = "m", mode = metadataSourceMode()) {
  if (!/^[a-z_]+$/.test(alias)) throw new Error("Invalid SQL alias");
  const shape = `(jsonb_typeof(${alias}.document)='object' AND length(${alias}.document->>'name')>0
    AND length(${alias}.document->>'id')>0 AND jsonb_typeof(${alias}.document->'attributes')='array')`;
  // Shape and hash checks validate one publication, not independent join keys.
  // Keep them together so the planner does not estimate a million valid rows
  // as a single result and choose repeated full-collection index scans.
  return mode === "archive" ? `(${alias}.source_kind='archive' AND ${alias}.publication_status='published'
    AND CASE WHEN ${shape} THEN true ELSE false END
    AND CASE WHEN ${alias}.publication_content_hash=${alias}.content_hash THEN true ELSE false END
    AND EXISTS(SELECT 1 FROM metadata_source.archive_release active_release
      WHERE active_release.release_id=${alias}.release_id AND active_release.state='active'))`
    : `(${alias}.fetch_status='success' AND ${shape})`;
}
