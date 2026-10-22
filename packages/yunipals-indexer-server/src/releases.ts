import type { Pool, PoolClient } from "pg";
import type { SourceManifest } from "../../yunipals-indexer-client/src/sources.js";
import type { IndexerRelease } from "../../yunipals-indexer-client/src/readiness.js";
import { validateSourceManifest } from "../../yunipals-indexer-client/src/sources.js";
import { sqlIdentifier } from "./database.js";
import { indexerTransaction } from "./database.js";
import { readPonderRuntime } from "./ponder-reader.js";
import { manifestDigest, sourceManifestHash } from "./identity.js";

export type RegisteredRelease = IndexerRelease & {
  id: string;
  manifest: SourceManifest;
};

export async function readBoundRuntime(
  db: Pick<PoolClient, "query">,
  release: RegisteredRelease
) {
  validateSourceManifest(release.manifest);
  if (sourceManifestHash(release.manifest) !== release.manifestHash)
    throw new Error("Release manifest hash mismatch.");
  const runtime = await readPonderRuntime(db, release.schema);
  if (runtime.buildId !== release.buildId)
    throw new Error(
      "Ponder build changed; a new candidate release is required."
    );
  const { rows } = await db.query<{
    id: string;
    chain_id: number;
    manifest_hash: string;
    definition: string;
  }>(
    `SELECT id,chain_id,manifest_hash,definition FROM ${sqlIdentifier(release.schema)}.indexer_source ORDER BY id`
  );
  if (rows.length !== release.manifest.sources.length)
    throw new Error("Ponder source setup is incomplete.");
  for (const row of rows) {
    const expected = release.manifest.sources.find(
      (source) => source.id === row.id
    );
    if (
      !expected ||
      row.chain_id !== expected.chainId ||
      row.manifest_hash !== release.manifestHash ||
      manifestDigest(JSON.parse(row.definition)) !== manifestDigest(expected)
    ) {
      throw new Error(
        "Ponder source definition does not match the registered release."
      );
    }
  }
  return runtime;
}

export async function loadIndexerRelease(
  db: Pick<PoolClient, "query">,
  id?: string
): Promise<RegisteredRelease> {
  const { rows } = await db.query<{
    id: string;
    physical_schema: string;
    build_id: string;
    manifest_hash: string;
    manifest: SourceManifest;
  }>(
    id
      ? "SELECT * FROM yunipals_indexer_control.release WHERE id=$1"
      : `SELECT r.* FROM yunipals_indexer_control.active_release a
      JOIN yunipals_indexer_control.release r ON r.id=a.release_id WHERE a.name='main'`,
    id ? [id] : []
  );
  const row = rows[0];
  if (!row) throw new Error("No selected shared indexer release.");
  const release = {
    id: row.id,
    schema: row.physical_schema,
    buildId: row.build_id,
    manifestHash: row.manifest_hash,
    manifest: row.manifest
  };
  validateSourceManifest(release.manifest);
  if (
    release.manifestHash !== sourceManifestHash(release.manifest) ||
    release.id !==
      manifestDigest({
        schema: release.schema,
        buildId: release.buildId,
        manifestHash: release.manifestHash
      })
  )
    throw new Error("Stored indexer release identity is invalid.");
  return release;
}
