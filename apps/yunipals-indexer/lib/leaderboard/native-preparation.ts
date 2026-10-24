import type { PoolClient } from "pg";

import { generationOwnershipProof } from "../ownership/projection-proof.js";
import { assertProjectionBuildCapacity } from "../metadata/projection-refresh.js";
import { metadataSourceMode } from "../metadata/publication.js";
import { projectionMode } from "../metadata/projection-mode.js";
import {
  captureProjectionInputs,
  nativeProjectionSnapshotEnabled,
  projectionPublicationSourcePredicate,
  projectionSourceSnapshot,
  type ProjectionSourceSnapshot
} from "../metadata/projection-snapshot.js";
import { populatePrivateWalletStats } from "./refresh.js";

export type PreparedNativeLeaderboard = Readonly<{
  generationId: string;
  predecessor: string | null;
  metadataReleaseId: string;
  sourceSnapshot: ProjectionSourceSnapshot;
  walletRows: string;
  walletRowsSha256: string;
}>;

type SessionPreparation = {
  handle: PreparedNativeLeaderboard;
  candidateSnapshot: ProjectionSourceSnapshot;
  relationOid: string;
};
const preparations = new WeakMap<PoolClient, SessionPreparation>();

function frozenSnapshot(snapshot: ProjectionSourceSnapshot) {
  const result = structuredClone(snapshot);
  for (const anchor of result.anchors) Object.freeze(anchor);
  Object.freeze(result.anchors);
  return Object.freeze(result);
}

async function transactionScope<T>(
  client: PoolClient,
  phase: "prepare" | "stage",
  action: () => Promise<T>
): Promise<T> {
  // SAVEPOINT is intentionally first: autocommit cannot satisfy this API.
  const point = `yunipals_leaderboard_${phase}`;
  await client.query(`SAVEPOINT ${point}`);
  try {
    const result = await client.query<{ isolation: string; readOnly: string }>(
      `SELECT current_setting('transaction_isolation') AS isolation,
        current_setting('transaction_read_only') AS "readOnly"`
    );
    if (
      result.rows[0]?.isolation !==
        (phase === "prepare" ? "repeatable read" : "read committed") ||
      result.rows[0].readOnly !== "off"
    )
      throw new Error("native_leaderboard_transaction_context_required");
    await client.query("SET LOCAL lock_timeout='500ms'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('yunipals:trait-refresh'))"
    );
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('yunipals:leaderboard-refresh'))"
    );
    await client.query(
      "SELECT pg_advisory_xact_lock_shared(hashtext('metadata:chain-recovery'))"
    );
    const value = await action();
    await client.query(`RELEASE SAVEPOINT ${point}`);
    return value;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${point}`).catch(() => undefined);
    await client.query(`RELEASE SAVEPOINT ${point}`).catch(() => undefined);
    throw error;
  }
}

async function candidateSnapshot(client: PoolClient, generationId: string) {
  const rows = (
    await client.query<{
      snapshot: unknown;
      metadata_release_id: string;
      predecessor: string | null;
    }>(
      `SELECT g.validation->'sourceSnapshot' AS snapshot,g.metadata_release_id,
        a.current_id::text AS predecessor FROM metadata_projection.generation g
        CROSS JOIN metadata_projection.active a
        WHERE g.id=$1 AND a.singleton AND g.state='ready' AND g.format_version=1
          AND g.published_at IS NULL AND g.source_mode='archive'
          AND g.id IS DISTINCT FROM a.current_id AND ${generationOwnershipProof("g")}
          AND EXISTS(SELECT 1 FROM metadata_source.archive_release r
            WHERE r.state='active' AND r.release_id=g.metadata_release_id)`,
      [generationId]
    )
  ).rows;
  if (rows.length !== 1)
    throw new Error("native_leaderboard_unpublished_candidate_required");
  const snapshot = projectionSourceSnapshot(rows[0]!.snapshot);
  if (
    snapshot.predecessor !== rows[0]!.predecessor ||
    snapshot.metadataReleaseId !== rows[0]!.metadata_release_id
  )
    throw new Error("native_leaderboard_candidate_context_changed");
  return snapshot;
}

function sameContext(
  candidate: ProjectionSourceSnapshot,
  input: ProjectionSourceSnapshot
) {
  return (
    candidate.predecessor === input.predecessor &&
    candidate.releaseId === input.releaseId &&
    candidate.readIdentity === input.readIdentity &&
    candidate.manifestHash === input.manifestHash &&
    candidate.physicalSchema === input.physicalSchema &&
    candidate.metadataReleaseId === input.metadataReleaseId &&
    candidate.baseMetadataFrontier === input.baseMetadataFrontier
  );
}

async function privateRows(client: PoolClient) {
  const result = await client.query<{
    oid: string;
    rows: string;
    sha256: string;
    private: boolean;
  }>(`SELECT c.oid::text AS oid,
    contents.rows,contents.sha256,
    c.relpersistence='t' AND c.relnamespace=pg_my_temp_schema()
      AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
      AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a
        WHERE a.grantee<>c.relowner) AS private
    FROM pg_class c CROSS JOIN LATERAL (
      SELECT count(*)::text AS rows,
        encode(sha256(convert_to(coalesce(string_agg(
          encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex'),''
          ORDER BY s.scope COLLATE "C",s.owner COLLATE "C"),''),'UTF8')),'hex') AS sha256
      FROM pg_temp.next_wallet_stats s
    )contents WHERE c.oid='pg_temp.next_wallet_stats'::regclass`);
  if (result.rows.length !== 1 || !result.rows[0]!.private)
    throw new Error("native_leaderboard_private_rows_required");
  return result.rows[0]!;
}

/** Use a dedicated client. Caller: BEGIN REPEATABLE READ -> prepare -> COMMIT.
 * Only temporary rows survive that COMMIT; no global publication is performed.
 * A rollback, disconnect, foreign client, or replacement temp table invalidates
 * the handle. All source/metadata inputs still use the ordinary 90-second guard.
 */
export async function prepareNativeLeaderboardCandidate(
  client: PoolClient,
  generationId: string
): Promise<PreparedNativeLeaderboard> {
  if (
    !nativeProjectionSnapshotEnabled() ||
    metadataSourceMode() !== "archive" ||
    projectionMode() !== "generation" ||
    !/^[1-9][0-9]{0,18}$/.test(generationId) ||
    BigInt(generationId) > 9223372036854775807n ||
    preparations.has(client)
  )
    throw new Error("native_leaderboard_preparation_context_required");
  const prepared = await transactionScope(client, "prepare", async () => {
    await assertProjectionBuildCapacity(client, "leaderboard");
    const input = await captureProjectionInputs(client);
    if (!input) throw new Error("native_leaderboard_input_required");
    const snapshot = await candidateSnapshot(client, generationId);
    if (!sameContext(snapshot, input.proof))
      throw new Error("native_leaderboard_input_context_changed");
    await populatePrivateWalletStats(client, input, new Date());
    const rows = await privateRows(client);
    return {
      handle: Object.freeze({
        generationId,
        predecessor: snapshot.predecessor,
        metadataReleaseId: snapshot.metadataReleaseId,
        sourceSnapshot: frozenSnapshot(input.proof),
        walletRows: rows.rows,
        walletRowsSha256: rows.sha256
      }),
      candidateSnapshot: frozenSnapshot(snapshot),
      relationOid: rows.oid
    };
  });
  preparations.set(client, prepared);
  return prepared.handle;
}

/** Caller: BEGIN READ COMMITTED -> stage -> publishGenerationInTransaction
 * with handle.sourceSnapshot -> COMMIT. Never commit staging without that final
 * publication CAS: it rechecks BOTH snapshots after the potentially slow copy.
 * Global changes remain invisible to other connections until caller COMMIT.
 */
export async function stagePreparedNativeLeaderboard(
  client: PoolClient,
  handle: PreparedNativeLeaderboard
): Promise<void> {
  const prepared = preparations.get(client);
  if (!prepared || prepared.handle !== handle)
    throw new Error("native_leaderboard_session_handle_required");
  await transactionScope(client, "stage", async () => {
    await client.query(
      "SELECT current_id FROM metadata_projection.active WHERE singleton FOR UPDATE"
    );
    const snapshot = await candidateSnapshot(client, handle.generationId);
    if (JSON.stringify(snapshot) !== JSON.stringify(prepared.candidateSnapshot))
      throw new Error("native_leaderboard_candidate_snapshot_changed");
    const rows = await privateRows(client);
    if (
      rows.oid !== prepared.relationOid ||
      rows.rows !== handle.walletRows ||
      rows.sha256 !== handle.walletRowsSha256
    )
      throw new Error("native_leaderboard_private_rows_changed");
    const current = await client.query<{ accepted: boolean }>(
      `SELECT (${projectionPublicationSourcePredicate("$1")}
        AND ${projectionPublicationSourcePredicate("$2")}) AS accepted`,
      [JSON.stringify(snapshot), JSON.stringify(handle.sourceSnapshot)]
    );
    if (current.rows[0]?.accepted !== true)
      throw new Error("native_leaderboard_publication_source_changed");
    await client.query("DELETE FROM leaderboard.wallet_stats");
    await client.query(`INSERT INTO leaderboard.wallet_stats(scope,owner,monster_count,total_rarity,
      unique_types,special_count,glitter_count,collector_score,score_version,updated_at)
      SELECT scope,owner,monster_count,total_rarity,unique_types,special_count,glitter_count,
        collector_score,score_version,updated_at FROM pg_temp.next_wallet_stats`);
    await client.query(
      `INSERT INTO metadata.derived_snapshot
        (name,metadata_release_id,ownership_release_id,ownership_read_identity)
        VALUES('leaderboard',$1,$2,$3) ON CONFLICT(name)DO UPDATE SET
        metadata_release_id=EXCLUDED.metadata_release_id,ownership_release_id=EXCLUDED.ownership_release_id,
        ownership_read_identity=EXCLUDED.ownership_read_identity,updated_at=now()`,
      [
        handle.metadataReleaseId,
        handle.sourceSnapshot.releaseId,
        handle.sourceSnapshot.readIdentity
      ]
    );
  });
}
