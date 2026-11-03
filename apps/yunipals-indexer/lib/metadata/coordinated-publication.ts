import type { PoolClient } from "pg";
import { collectionSlugs } from "../constants.js";
import {
  prepareNativeLeaderboardCandidate,
  stagePreparedNativeLeaderboard
} from "../leaderboard/native-preparation.js";
import {
  publishGenerationInTransaction,
  retainProjectionAnchors
} from "./projection-refresh.js";
import { projectionSourceSnapshot } from "./projection-snapshot.js";
import { preparedReadCacheFreshSql } from "./read-cache.js";

type Receipt = Record<string, unknown>;

/** A lost COMMIT response must be inspected, never retried automatically. */
export class PublicationCommitUnconfirmed extends Error {
  constructor() {
    super("projection_publication_commit_unconfirmed");
  }
}

/** Publish the wallet rows, both derived stamps and the generation pointer in
 * one caller-owned transaction. Only private temporary rows survive preparation.
 * The record callback must durably persist each intent before returning. */
export async function publishPreparedGeneration(
  client: PoolClient,
  input: {
    generationId: string;
    predecessor: string;
    record: (phase: string, receipt: Receipt) => Promise<void>;
    refreshApproval: () => Promise<unknown>;
  }
) {
  const validId = (id: string) =>
    /^[1-9][0-9]{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n;
  if (
    !validId(input.generationId) ||
    !validId(input.predecessor) ||
    input.generationId === input.predecessor
  )
    throw new Error("projection_publication_invalid_ids");
  const locks: { name: string; shared: boolean }[] = [];
  let transactionOpen = false;
  let commitAttempted = false;
  let commitConfirmed = false;
  const assertCache = async () => {
    const result = await client.query<{ fresh: boolean }>(
      `SELECT ${preparedReadCacheFreshSql(input.generationId, collectionSlugs)} AS fresh`
    );
    if (result.rows[0]?.fresh !== true)
      throw new Error("projection_prepared_cache_unavailable");
  };
  try {
    for (const lock of [
      { name: "yunipals:trait-refresh", shared: false },
      { name: "yunipals:leaderboard-refresh", shared: false },
      { name: "metadata:chain-recovery", shared: true }
    ]) {
      const result = await client.query<{ acquired: boolean }>(
        `SELECT pg_try_advisory_lock${lock.shared ? "_shared" : ""}(hashtext($1)) AS acquired`,
        [lock.name]
      );
      if (!result.rows[0]?.acquired)
        throw new Error("projection_publication_writer_busy");
      locks.push(lock);
    }
    const candidate = (
      await client.query<{ snapshot: unknown }>(
        `SELECT g.validation->'sourceSnapshot' AS snapshot
        FROM metadata_projection.generation g CROSS JOIN metadata_projection.active a
        WHERE g.id=$1 AND g.state='ready' AND g.published_at IS NULL
          AND a.singleton AND a.current_id=$2 AND g.id NOT IN(a.current_id,a.previous_id)`,
        [input.generationId, input.predecessor]
      )
    ).rows[0];
    const snapshot = projectionSourceSnapshot(candidate?.snapshot);
    if (snapshot.predecessor !== input.predecessor)
      throw new Error("projection_predecessor_changed");
    await retainProjectionAnchors(client, snapshot);
    await input.refreshApproval();
    await assertCache();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    transactionOpen = true;
    const handle = await prepareNativeLeaderboardCandidate(
      client,
      input.generationId
    );
    await input.record("wallet_prepared", { ...handle });
    await client.query("COMMIT");
    transactionOpen = false;
    await retainProjectionAnchors(client, snapshot);
    await retainProjectionAnchors(client, handle.sourceSnapshot);
    await input.refreshApproval();
    await assertCache();
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    transactionOpen = true;
    await stagePreparedNativeLeaderboard(client, handle);
    await publishGenerationInTransaction(
      client,
      input.generationId,
      handle.metadataReleaseId,
      input.predecessor,
      handle.sourceSnapshot
    );
    const xid = (
      await client.query<{ xid: string }>(
        "SELECT pg_current_xact_id()::text AS xid"
      )
    ).rows[0]!.xid;
    await input.record("publication_intent", {
      generationId: input.generationId,
      predecessor: input.predecessor,
      xid,
      walletRows: handle.walletRows,
      walletRowsSha256: handle.walletRowsSha256
    });
    commitAttempted = true;
    await client.query("COMMIT");
    transactionOpen = false;
    commitConfirmed = true;
    await input.record("publication_committed", {
      generationId: input.generationId,
      predecessor: input.predecessor,
      xid
    });
    return { generationId: input.generationId, predecessor: input.predecessor };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    if (commitAttempted && !commitConfirmed)
      throw new PublicationCommitUnconfirmed();
    throw error;
  } finally {
    for (const lock of locks.reverse())
      await client
        .query(
          `SELECT pg_advisory_unlock${lock.shared ? "_shared" : ""}(hashtext($1))`,
          [lock.name]
        )
        .catch(() => undefined);
  }
}
