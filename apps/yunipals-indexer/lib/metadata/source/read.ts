import type { Pool } from "pg";
import { assetKey, contentHash } from "./canonical.js";
import { decodeSource } from "./ejson.js";
import { historicalOriginIds, renderRainbowOrigins } from "../render/origins.js";
import { renderLegacySnapshot, rendererVersion } from "../render/snapshot.js";
import { isRainbowByAttrs } from "../render/legacy.cjs";

export type StoredSource = { assetKey: string; hash: string; payload: unknown; burned: boolean; importedAt: Date; issue: string | null };
export class ArchiveLookupError extends Error {
  constructor(public readonly code: "source_missing" | "parent_missing" | "alias_ambiguous" | "source_invalid" | "archive_unavailable") {
    super(code); this.name = "ArchiveLookupError";
  }
}

/** Archive snapshots only. This intentionally makes no current-owner claim. */
export class ArchiveReader {
  constructor(private readonly pool: Pool, private readonly release: string, private readonly candidate = false) {}

  async checkRelease() {
    const result = await this.pool.query("SELECT state FROM metadata_source.archive_release WHERE release_id=$1", [this.release]);
    if (!result.rowCount || (this.candidate ? !["candidate","validated","active","superseded"].includes(result.rows[0].state)
      : result.rows[0].state !== "active")) throw new ArchiveLookupError("archive_unavailable");
  }

  async byAsset(key: string): Promise<StoredSource> {
    await this.checkRelease();
    const result = await this.pool.query<StoredSource>(`SELECT r.asset_key AS "assetKey",r.content_hash AS hash,b.payload,
      r.source_burned AS burned,r.imported_at AS "importedAt",r.issue
      FROM metadata_source.source_record r JOIN metadata_source.source_blob b USING(content_hash)
      WHERE r.release_id=$1 AND r.asset_key=$2
      ORDER BY r.source_burned ASC, r.source_key ASC LIMIT 1`, [this.release,key]);
    if (!result.rowCount) throw new ArchiveLookupError("source_missing");
    if (result.rows[0].issue) throw new ArchiveLookupError("source_invalid");
    return result.rows[0];
  }

  async lookup(id: string, family?: string, publicAliases = true) {
    await this.checkRelease();
    const aliases = await this.pool.query<{ assetKey: string }>(`SELECT DISTINCT asset_key AS "assetKey"
      FROM metadata_source.lookup_alias WHERE release_id=$1 AND namespace=CASE WHEN $3::text IS NULL THEN 'legacy-meta' ELSE 'legacy-family' END AND alias=$2
      AND ($3::text IS NULL OR family=$3)
      AND ($4 OR $3::text IS NOT NULL OR NOT EXISTS(SELECT 1 FROM metadata_source.source_record exomon
        WHERE exomon.release_id=$1 AND exomon.namespace='legacy.exomon-aliases' AND exomon.source_key=$2)) LIMIT 2`, [this.release,id,family ?? null,publicAliases]);
    const matches = aliases.rowCount ? aliases : await this.pool.query<{ assetKey: string }>(`SELECT DISTINCT asset_key AS "assetKey"
      FROM metadata_source.source_record WHERE release_id=$1 AND legacy_id=$2
      AND ($3::text IS NULL OR family=$3) AND asset_key IS NOT NULL LIMIT 2`, [this.release,id,family ?? null]);
    if (!matches.rowCount) throw new ArchiveLookupError("source_missing");
    if (matches.rows.length !== 1) throw new ArchiveLookupError("alias_ambiguous");
    return this.byAsset(matches.rows[0].assetKey);
  }

  async snapshot(id: string, family?: string, publicFacing = true) {
    const source = await this.lookup(id,family);
    return this.renderSource(source,publicFacing);
  }

  async snapshotByAsset(key: string, publicFacing = true, legacyFactoryOnly = false) {
    return this.renderSource(await this.byAsset(key),publicFacing,legacyFactoryOnly);
  }

  async renderSource(source: StoredSource, publicFacing: boolean, legacyFactoryOnly = false) {
    if (source.issue || !source.assetKey) throw new ArchiveLookupError("source_invalid");
    const decoded = decodeSource(source.payload) as { nft: Parameters<typeof isRainbowByAttrs>[0] };
    const parentHashes: string[] = [];
    let rainbow;
    if (isRainbowByAttrs(decoded.nft)) {
      const ids = historicalOriginIds(decoded);
      const parents = [];
      for (const id of ids) {
        const parent = await this.byAsset(assetKey("GEN1",id)).catch(error => {
          if (error instanceof ArchiveLookupError && error.code === "source_missing") throw new ArchiveLookupError("parent_missing");
          throw error;
        });
        parentHashes.push(parent.hash); parents.push(decodeSource(parent.payload));
      }
      rainbow = renderRainbowOrigins(ids,parents);
    }
    return { assetKey: source.assetKey, sourceBurned: source.burned, rendererVersion,
      variant: legacyFactoryOnly ? "legacy-factory" as const : publicFacing ? "public" as const : "internal" as const,
      inputHash: contentHash([source.hash, ...parentHashes]),
      document: renderLegacySnapshot(decoded, { publicFacing, legacyFactoryOnly,
        metadataUpdatedAt: Math.floor(source.importedAt.getTime()/1000), rainbow }) };
  }
}
