import type { Pool } from "pg";
import {
  validateSourceManifest,
  type SourceManifest
} from "../../../../packages/yunipals-indexer-client/src/sources.js";
import {
  sqlIdentifier,
  indexerTransaction
} from "../../../../packages/yunipals-indexer-server/src/database.js";
import {
  manifestDigest,
  sourceManifestHash
} from "../../../../packages/yunipals-indexer-server/src/identity.js";
import {
  readBoundRuntime,
  type RegisteredRelease
} from "../../../../packages/yunipals-indexer-server/src/releases.js";
export {
  readBoundRuntime,
  loadIndexerRelease,
  type RegisteredRelease
} from "../../../../packages/yunipals-indexer-server/src/releases.js";

export async function registerIndexerRelease(
  pool: Pick<Pool, "connect">,
  input: { schema: string; buildId: string; manifest: SourceManifest }
): Promise<RegisteredRelease> {
  sqlIdentifier(input.schema);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.buildId))
    throw new Error("Invalid Ponder build ID.");
  validateSourceManifest(input.manifest);
  const release: RegisteredRelease = {
    schema: input.schema,
    buildId: input.buildId,
    manifest: input.manifest,
    manifestHash: sourceManifestHash(input.manifest),
    id: manifestDigest({
      schema: input.schema,
      buildId: input.buildId,
      manifestHash: sourceManifestHash(input.manifest)
    })
  };
  return indexerTransaction(pool, async (db) => {
    await readBoundRuntime(db, release);
    await db.query(
      `INSERT INTO yunipals_indexer_control.release(id,physical_schema,build_id,manifest_hash,manifest)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [
        release.id,
        release.schema,
        release.buildId,
        release.manifestHash,
        JSON.stringify(release.manifest)
      ]
    );
    const stored = await db.query<{ id: string; manifest: SourceManifest }>(
      "SELECT id,manifest FROM yunipals_indexer_control.release WHERE physical_schema=$1",
      [release.schema]
    );
    if (
      stored.rows[0]?.id !== release.id ||
      manifestDigest(stored.rows[0].manifest) !==
        manifestDigest(release.manifest)
    ) {
      throw new Error(
        "A physical Ponder schema cannot be reassigned to another release."
      );
    }
    return release;
  });
}
