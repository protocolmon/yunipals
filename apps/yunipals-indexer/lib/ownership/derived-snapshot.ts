import type { Pool } from "pg";
import { unifiedOwnershipReads } from "../offchain/sql.js";
import { ownershipReadIdentity } from "./readiness.js";
import { generationOwnershipProof } from "./projection-proof.js";
import { metadataSourceMode } from "../metadata/publication.js";

export async function stampDerivedSnapshot(
  db: Pick<Pool, "query">,
  name: "traits" | "leaderboard",
  release: string | null
) {
  if (!unifiedOwnershipReads) {
    if (release)
      await db.query(
        `INSERT INTO metadata.derived_snapshot(name,metadata_release_id) VALUES($1,$2)
      ON CONFLICT(name) DO UPDATE SET metadata_release_id=EXCLUDED.metadata_release_id,updated_at=now()`,
        [name, release]
      );
    return;
  }
  const identity = (await ownershipReadIdentity(db))!;
  await db.query(
    `INSERT INTO metadata.derived_snapshot(name,metadata_release_id,ownership_release_id,ownership_read_identity)
    VALUES($1,$2,$3,$4) ON CONFLICT(name) DO UPDATE SET metadata_release_id=EXCLUDED.metadata_release_id,
    ownership_release_id=EXCLUDED.ownership_release_id,ownership_read_identity=EXCLUDED.ownership_read_identity,updated_at=now()`,
    [name, release ?? "legacy-http", identity.release_id, identity.identity]
  );
}
export async function assertDerivedOwnership(
  db: Pick<Pool, "query">,
  name: "traits" | "leaderboard"
) {
  if (!unifiedOwnershipReads) return;
  if (
    !(
      await db.query(
        `SELECT 1 FROM metadata.derived_snapshot snapshot WHERE snapshot.name=$1
    AND ${generationOwnershipProof("snapshot")}
    ${
      metadataSourceMode() === "archive"
        ? `AND EXISTS(SELECT 1 FROM metadata_source.archive_release active WHERE active.state='active'
      AND active.release_id=snapshot.metadata_release_id)`
        : ""
    }`,
        [name]
      )
    ).rowCount
  )
    throw new Error("derived_snapshot_pending");
}
