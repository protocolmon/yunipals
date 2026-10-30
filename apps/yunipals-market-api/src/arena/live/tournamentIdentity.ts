import {
  parseArenaDeployment,
  arenaKind
} from "@protopals/yunipals-market-core/arenaProtocol";
import type { PoolClient } from "pg";
import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";
import type {
  NativeArenaObservation,
  NativeArenaTournament
} from "./nativeSource";

export type TournamentIdentity = {
  deployment: string;
  tournament_id: string;
  incarnation: string;
  opened_event_id: string;
  opened_block_hash: string;
  bound_release_id: string;
  cipher_context: string;
};
type Observed = NativeArenaObservation & { tournament: NativeArenaTournament };
type Queryable = Pick<PoolClient, "query">;
function assertObservation(observed: Observed) {
  const t = observed.tournament;
  const deployment = parseArenaDeployment(t.deployment);
  const expected = manifestDigest({
    deployment: t.deployment,
    tournamentId: t.id,
    openedEventId: t.opened.id,
    openedBlockHash: t.opened.blockHash
  });
  if (
    expected !== t.incarnation ||
    !/^(0|[1-9][0-9]*)$/.test(t.id) ||
    BigInt(t.id) >= 2n ** 256n ||
    (deployment.version === 2 &&
      (BigInt(t.id) <= 0n ||
        arenaKind((BigInt(t.id) - 1n) % 2n) !== deployment.mediaKind)) ||
    t.id !== t.state.id ||
    !/^0x[0-9a-f]{64}$/.test(observed.releaseId) ||
    !/^0x[0-9a-f]{64}$/.test(t.opened.blockHash) ||
    !/^0x[0-9a-f]{64}$/.test(t.opened.transactionHash) ||
    !Number.isSafeInteger(t.opened.logIndex) ||
    t.opened.logIndex < 0 ||
    t.opened.id !==
      `${deployment.canonicalPrefix}:${t.opened.transactionHash}:${t.opened.logIndex}`
  )
    throw new Error("Invalid observed Arena identity.");
}
async function selectedMode(
  db: Queryable,
  deployment: string,
  adopting = false
) {
  const row = (
    await db.query<{ indexer_mode: string; halted: boolean }>(
      "SELECT indexer_mode,halted FROM yunipals_arena.deployment WHERE id=$1 FOR SHARE",
      [deployment]
    )
  ).rows[0];
  if (row?.indexer_mode !== "unified" || (adopting && !row.halted))
    throw new Error(
      "Arena identity migration requires a fenced native deployment."
    );
}
async function identity(db: Queryable, t: NativeArenaTournament) {
  const row = (
    await db.query<TournamentIdentity>(
      `SELECT deployment,tournament_id::text,incarnation,
    opened_event_id,opened_block_hash,bound_release_id,cipher_context FROM yunipals_arena.tournament_identity
    WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3 FOR UPDATE`,
      [t.deployment, t.id, t.incarnation]
    )
  ).rows[0];
  if (
    !row ||
    row.opened_event_id !== t.opened.id ||
    row.opened_block_hash !== t.opened.blockHash
  )
    throw new Error("Arena durable identity differs from its observed origin.");
  return row;
}

/** Caller uses one operational transaction. Persisting an observed origin is
 * not evidence that it remains canonical; every consumer must re-read Ponder.
 */
export async function registerTournamentIdentity(
  db: Queryable,
  observed: Observed
) {
  assertObservation(observed);
  const t = observed.tournament;
  await selectedMode(db, t.deployment);
  if (
    (
      await db.query(
        `SELECT 1 FROM yunipals_arena.tournament_identity
    WHERE deployment=$1 AND tournament_id=$2 AND incarnation='legacy'`,
        [t.deployment, t.id]
      )
    ).rowCount
  )
    throw new Error("Legacy Arena records require explicit origin adoption.");
  await db.query(
    `INSERT INTO yunipals_arena.tournament_identity(deployment,tournament_id,incarnation,
    opened_event_id,opened_block_hash,bound_release_id,bound_at,cipher_context)
    VALUES($1,$2,$3,$4,$5,$6,now(),$7) ON CONFLICT DO NOTHING`,
    [
      t.deployment,
      t.id,
      t.incarnation,
      t.opened.id,
      t.opened.blockHash,
      observed.releaseId,
      `${t.deployment}/${t.id}/${t.incarnation}`
    ]
  );
  return identity(db, t);
}

/** Explicit legacy migration, not part of request/startup handling. Preserve
 * ciphertext AAD and let durable FKs carry private rows to the verified origin.
 */
export async function adoptLegacyTournamentIdentity(
  db: Queryable,
  observed: Observed
) {
  assertObservation(observed);
  const t = observed.tournament;
  // The old projector holds this same key while fetching and committing a
  // range. Adoption must not race its last public/private InputFrozen writes.
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `arena/project/${t.deployment}`
  ]);
  await selectedMode(db, t.deployment, true);
  const legacy = (
    await db.query(
      `SELECT 1 FROM yunipals_arena.tournament_identity
    WHERE deployment=$1 AND tournament_id=$2 AND incarnation='legacy' FOR UPDATE`,
      [t.deployment, t.id]
    )
  ).rowCount;
  if (!legacy) return identity(db, t);
  const opening = (
    await db.query<{
      transaction_hash: string;
      log_index: number;
      block_number: string;
      block_hash: string;
      args: Record<string, unknown>;
    }>(
      `SELECT transaction_hash,log_index,block_number::text,block_hash,args FROM yunipals_arena.chain_event
      WHERE deployment=$1 AND event_name='TournamentOpened' AND args->>'id'=$2`,
      [t.deployment, t.id]
    )
  ).rows;
  if (
    opening.length !== 1 ||
    opening[0]!.transaction_hash !== t.opened.transactionHash ||
    opening[0]!.log_index !== t.opened.logIndex ||
    opening[0]!.block_number !== t.opened.blockNumber ||
    opening[0]!.block_hash !== t.opened.blockHash ||
    opening[0]!.args.rulesHash !== t.state.rulesHash ||
    opening[0]!.args.poolHash !== t.state.poolHash
  )
    throw new Error(
      "Legacy Arena opening does not match the native origin; reconciliation required."
    );
  await db.query(
    `UPDATE yunipals_arena.tournament_identity SET incarnation=$3,opened_event_id=$4,
    opened_block_hash=$5,bound_release_id=$6,bound_at=now() WHERE deployment=$1 AND tournament_id=$2 AND incarnation='legacy'`,
    [
      t.deployment,
      t.id,
      t.incarnation,
      t.opened.id,
      t.opened.blockHash,
      observed.releaseId
    ]
  );
  return identity(db, t);
}
