import type { Pool, PoolClient } from "pg";
import { collections } from "../constants.js";
import { ownershipReadIdentity } from "../ownership/readiness.js";
import { physicalPonderSchema, ponderSchema } from "../offchain/sql.js";
import { nativeBaseMetadataReads } from "./base-mode.js";
import { approvedBaseMetadataImplementation } from "./base-implementation.js";
import type { BaseMetadataPointRpc } from "./unified-base.js";
import { manifestDigest } from "../../../../packages/yunipals-indexer-server/src/identity.js";
import { baseMetadataAbi } from "./base-abi.js";
import { nativeBaseTraitsSql } from "./native-base-traits.js";
import {
  publicationRequestKey,
  type PublicationRequestInput
} from "./publication-request.js";

const metadataAbiHash = manifestDigest(baseMetadataAbi);

type NativeFrame = {
  block_number: string;
  block_hash: string;
  frontier: string;
};
async function frame(db: PoolClient): Promise<NativeFrame> {
  const row = (
    await db.query<NativeFrame>(`SELECT block_number::text,block_hash,frontier
    FROM ${ponderSchema}.base_metadata_frame(false)`)
  ).rows[0];
  if (
    !row ||
    !/^\d+$/.test(row.block_number) ||
    !/^0x[0-9a-f]{64}$/.test(row.block_hash)
  )
    throw new Error("Native Base metadata frame unavailable.");
  return row;
}

async function pointCheck(rpc: BaseMetadataPointRpc, boundary: NativeFrame) {
  if ((await rpc.chainId()) !== 8453)
    throw new Error("Base metadata RPC chain mismatch.");
  if (
    (await rpc.blockHash(BigInt(boundary.block_number))) !== boundary.block_hash
  )
    throw new Error("Native Base metadata boundary changed.");
  if (
    (await rpc.implementation(BigInt(boundary.block_number))) !==
    approvedBaseMetadataImplementation
  )
    throw new Error("Base implementation needs ABI review.");
  if (
    (await rpc.blockHash(BigInt(boundary.block_number))) !== boundary.block_hash
  )
    throw new Error("Native Base metadata boundary changed during code check.");
}

async function withNativeWriter<T>(
  pool: Pool,
  task: (db: PoolClient) => Promise<T>
) {
  if (!nativeBaseMetadataReads())
    throw new Error("Native Base metadata mode is required.");
  const db = await pool.connect();
  let acquired = false;
  try {
    acquired =
      (
        await db.query<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock(hashtext('metadata:base-replay')) AS acquired"
        )
      ).rows[0]?.acquired === true;
    if (!acquired) return { busy: true as const };
    return await task(db);
  } finally {
    if (acquired)
      await db
        .query("SELECT pg_advisory_unlock(hashtext('metadata:base-replay'))")
        .finally(() => db.release());
    else db.release();
  }
}

async function approve(
  db: PoolClient,
  identity: { release_id: string; identity: string },
  boundary: NativeFrame
) {
  await db.query(
    `INSERT INTO metadata_source.native_base_metadata_state
    (release_id,read_identity,state,frontier,implementation,checked_block,checked_hash,checked_at,error_code)
    VALUES($1,$2,'ready',$3,$4,$5,$6,clock_timestamp(),NULL)
    ON CONFLICT(release_id) DO UPDATE SET read_identity=EXCLUDED.read_identity,state='ready',frontier=EXCLUDED.frontier,
      implementation=EXCLUDED.implementation,checked_block=EXCLUDED.checked_block,checked_hash=EXCLUDED.checked_hash,
      checked_at=EXCLUDED.checked_at,error_code=NULL`,
    [
      identity.release_id,
      identity.identity,
      boundary.frontier,
      approvedBaseMetadataImplementation,
      boundary.block_number,
      boundary.block_hash
    ]
  );
}

/** Explicit cutover only. Ponder must contain every legacy event through the
 * captured cursor, with exactly the same decoded data and inclusion hashes.
 * The old cursor is preserved for rollback; neither worker can advance it in
 * native mode. This is intentionally not called by the normal worker.
 */
export async function adoptNativeBaseMetadata(
  pool: Pool,
  rpc: BaseMetadataPointRpc
) {
  return withNativeWriter(pool, async (db) => {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try {
      await db.query("SET LOCAL statement_timeout='10min'");
      const identity = await ownershipReadIdentity(db);
      if (!identity)
        throw new Error("A registered native read identity is required.");
      const boundary = await frame(db);
      const scan = (
        await db.query(`SELECT chain_id,contract_address,deployment_block::text,next_block::text,ingestion_mode
        FROM metadata_source.chain_metadata_scan WHERE name='base_metadata_v1' FOR UPDATE`)
      ).rows[0];
      if (
        !scan ||
        scan.chain_id !== 8453 ||
        scan.contract_address !== collections.base.address ||
        scan.deployment_block !== String(collections.base.deploymentBlock) ||
        BigInt(scan.next_block) < BigInt(scan.deployment_block) ||
        BigInt(scan.next_block) - 1n > BigInt(boundary.block_number)
      )
        throw new Error(
          "Native Base metadata has not covered the legacy cursor."
        );
      // Compare every transaction in the same snapshot, while bounding the
      // materialized JSON payloads per query. Hash buckets also cover malformed
      // text keys; no transaction is excluded by a hexadecimal-prefix filter.
      for (let partition = 0; partition < 16; partition++) {
        const mismatch = (
          await db.query(
            `WITH legacy AS MATERIALIZED (
        SELECT transaction_hash,log_index,transaction_index,block_number,block_hash,event_name,token_id,recipient,traits
        FROM metadata_source.chain_metadata_event WHERE chain_id=8453 AND contract_address=$1 AND block_number<$2
          AND (hashtextextended(transaction_hash,0) & 15)=$5),
        native AS MATERIALIZED (
        SELECT e.transaction_hash,e.log_index,e.transaction_index,e.block_number,e.block_hash,e.name AS event_name,
          e.args::jsonb->>'tokenId' AS token_id,lower(e.args::jsonb->>'to') AS recipient,${nativeBaseTraitsSql} AS traits
        FROM ${physicalPonderSchema}.canonical_event e WHERE e.source_id='metadata:base' AND e.chain_id=8453
          AND e.address=$1 AND e.block_number>=$3 AND e.block_number<$2 AND e.abi_hash=$4
          AND (hashtextextended(e.transaction_hash,0) & 15)=$5)
        SELECT 1 FROM legacy l FULL JOIN native n USING(transaction_hash,log_index)
        WHERE (l.transaction_index,l.block_number,l.block_hash,l.event_name,l.token_id,l.recipient,l.traits)
          IS DISTINCT FROM (n.transaction_index,n.block_number,n.block_hash,n.event_name,n.token_id,n.recipient,n.traits) LIMIT 1`,
            [
              collections.base.address,
              scan.next_block,
              scan.deployment_block,
              metadataAbiHash,
              partition
            ]
          )
        ).rowCount;
        if (mismatch)
          throw new Error(
            "Native/legacy Base metadata parity failed; no cutover performed."
          );
      }
      await pointCheck(rpc, boundary);
      await db.query(
        "UPDATE metadata_source.chain_metadata_scan SET ingestion_mode='native',updated_at=now() WHERE name='base_metadata_v1'"
      );
      await approve(db, identity, boundary);
      await db.query("COMMIT");
      return {
        adopted: true,
        releaseId: identity.release_id,
        readIdentity: identity.identity,
        legacyNextBlock: scan.next_block,
        blockNumber: boundary.block_number,
        frontier: boundary.frontier
      };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  });
}

/** Bounded point calls only. Quiet blocks do not require another event scan or
 * approval write. A new event frontier, reorg, or periodic code check triggers
 * a fresh implementation check. Approval failures leave Base unavailable.
 */
export async function refreshNativeBaseMetadata(
  pool: Pool,
  rpc: BaseMetadataPointRpc
) {
  return withNativeWriter(pool, async (db) => {
    const identity = await ownershipReadIdentity(db);
    if (!identity)
      throw new Error("Native Base metadata read identity unavailable.");
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    let transactionOpen = true;
    try {
      const boundary = await frame(db);
      const state = (
        await db.query(
          `SELECT a.*,a.checked_at>statement_timestamp()-interval '60 seconds'
        AND a.checked_at<=statement_timestamp() AND a.checked_block<=$2
        AND EXISTS(SELECT 1 FROM ${physicalPonderSchema}.chain_block b WHERE b.chain_id=8453
          AND b.block_number=a.checked_block AND b.block_hash=a.checked_hash) AS fresh
        FROM metadata_source.native_base_metadata_state a
        JOIN metadata_source.chain_metadata_scan s ON s.name='base_metadata_v1' AND s.ingestion_mode='native'
        WHERE a.release_id=$1`,
          [identity.release_id, boundary.block_number]
        )
      ).rows[0];
      if (!state || state.read_identity !== identity.identity)
        throw new Error("Native Base metadata requires explicit adoption.");
      if (
        state.state === "ready" &&
        state.frontier === boundary.frontier &&
        state.implementation === approvedBaseMetadataImplementation &&
        state.fresh
      ) {
        await db.query("COMMIT");
        return {
          checked: false,
          blockNumber: boundary.block_number,
          frontier: boundary.frontier
        };
      }
      await db.query("COMMIT");
      transactionOpen = false;
      await pointCheck(rpc, boundary);
      // Point RPC calls do not hold an MVCC transaction open. Check the new
      // database snapshot before granting approval for the captured frontier.
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      transactionOpen = true;
      const current = await frame(db);
      const stillCanonical =
        (
          await db.query(
            `SELECT 1 FROM ${physicalPonderSchema}.chain_block
        WHERE chain_id=8453 AND block_number=$1 AND block_hash=$2`,
            [boundary.block_number, boundary.block_hash]
          )
        ).rowCount === 1;
      const stillAdopted =
        (
          await db.query(`SELECT 1 FROM metadata_source.chain_metadata_scan
        WHERE name='base_metadata_v1' AND ingestion_mode='native'`)
        ).rowCount === 1;
      if (
        current.frontier !== boundary.frontier ||
        BigInt(current.block_number) < BigInt(boundary.block_number) ||
        !stillCanonical ||
        !stillAdopted
      )
        throw new Error("Native Base metadata changed during approval.");
      await approve(db, identity, boundary);
      await db.query("COMMIT");
      return {
        checked: true,
        blockNumber: boundary.block_number,
        frontier: boundary.frontier
      };
    } catch (error) {
      if (transactionOpen) await db.query("ROLLBACK");
      await db.query(
        `UPDATE metadata_source.native_base_metadata_state SET state='blocked',error_code='native_base_check_failed'
        WHERE release_id=$1 AND read_identity=$2 AND (state<>'blocked' OR error_code IS DISTINCT FROM 'native_base_check_failed')`,
        [identity.release_id, identity.identity]
      );
      throw error;
    }
  });
}

/** Optional bounded migration step after adoption. Stamp only publications
 * whose saved event still matches both journals and the current latest event.
 * Missing or changed proofs remain unavailable and must be republished.
 */
export async function backfillNativeBaseMetadataProvenance(
  pool: Pool,
  batchSize = 5000
) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10000)
    throw new Error("Invalid native provenance batch size.");
  return withNativeWriter(pool, async (db) => {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try {
      await ownershipReadIdentity(db);
      const result = await db.query<
        PublicationRequestInput & {
          token_id: string;
          lifecycle: number;
          mint_transaction_hash: string;
          mint_log_index: number;
          publication_status: string;
        }
      >(
        `WITH candidates AS MATERIALIZED (
        SELECT p.collection,p.token_id,p.lifecycle,latest.block_hash,b.asset_key,b.input_hash,
          latest.transaction_hash AS event_transaction,latest.log_index AS event_log FROM metadata.token_publication p
        CROSS JOIN ${ponderSchema}.base_metadata_frame(true) f
        JOIN LATERAL(SELECT e.transaction_hash,e.log_index,e.block_hash,${nativeBaseTraitsSql} AS traits
          FROM ${physicalPonderSchema}.canonical_event e WHERE e.source_id='metadata:base'
          AND e.chain_id=8453 AND e.address=$1 AND e.abi_hash=$3
          AND e.args::jsonb->>'tokenId'=p.token_id::text AND e.block_number<=f.block_number
          ORDER BY e.block_number DESC,e.transaction_index DESC,e.log_index DESC LIMIT 1) latest ON true
        JOIN metadata_source.chain_metadata_event old ON old.chain_id=8453 AND old.contract_address=$1
          AND old.transaction_hash=latest.transaction_hash AND old.log_index=latest.log_index
          AND old.block_hash=latest.block_hash AND old.traits=latest.traits AND old.token_id=p.token_id::text
        LEFT JOIN metadata_source.lifecycle_binding b ON b.release_id=p.release_id AND b.chain_id='8453'
          AND b.contract_address=$1 AND b.token_id=p.token_id::text
          AND b.mint_transaction_hash=p.mint_transaction_hash AND b.mint_log_index=p.mint_log_index
        WHERE p.collection='base' AND p.chain_event_block_hash IS NULL
          AND p.source_kind='archive' AND EXISTS(SELECT 1 FROM metadata_source.archive_release r
            WHERE r.release_id=p.release_id AND r.state='active')
          AND p.chain_event_key=latest.transaction_hash||':'||latest.log_index::text
        ORDER BY p.token_id,p.lifecycle LIMIT $2 FOR UPDATE OF p)
        UPDATE metadata.token_publication p SET chain_event_block_hash=c.block_hash
        FROM candidates c WHERE p.collection=c.collection AND p.token_id=c.token_id AND p.lifecycle=c.lifecycle
        RETURNING p.token_id::text,p.lifecycle,p.mint_transaction_hash,p.mint_log_index,p.publication_status,
          c.asset_key,c.input_hash,c.event_transaction,c.event_log,c.block_hash AS event_block_hash`,
        [collections.base.address, batchSize, metadataAbiHash]
      );
      // A proven historical publication needs only a stronger request identity,
      // not another render. Never adopt an unknown key or an in-flight claim.
      const jobs = result.rows
        .filter((row) => row.publication_status === "published")
        .map((row) => ({
          tokenId: row.token_id,
          lifecycle: row.lifecycle,
          mintTransaction: row.mint_transaction_hash,
          mintLog: row.mint_log_index,
          previousKey: publicationRequestKey(row),
          nextKey: publicationRequestKey(row, true)
        }));
      await db.query(
        `UPDATE metadata.publication_job j SET request_key=x."nextKey"
        FROM jsonb_to_recordset($1::jsonb) AS x("tokenId" text,lifecycle integer,"mintTransaction" text,"mintLog" integer,"previousKey" text,"nextKey" text)
        WHERE j.collection='base' AND j.token_id=x."tokenId"::numeric AND j.lifecycle=x.lifecycle
          AND j.mint_transaction_hash=x."mintTransaction" AND j.mint_log_index=x."mintLog"
          AND j.request_key=x."previousKey" AND j.status='published' AND j.reason IS NULL
          AND EXISTS(SELECT 1 FROM metadata_source.archive_release r WHERE r.release_id=j.release_id AND r.state='active')`,
        [JSON.stringify(jobs)]
      );
      await db.query("COMMIT");
      return { stamped: result.rowCount ?? 0 };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  });
}
