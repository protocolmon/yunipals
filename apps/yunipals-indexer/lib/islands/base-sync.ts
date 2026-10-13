import type { Pool, PoolClient } from "pg";
import { transferState, type TokenState } from "../ownership/transfer.js";
import { baseIslandCollection as collection } from "./collections.js";

const schema = collection.schemaName;
export const baseWorkerVersion = "base-islands-logs-v1";
export type BaseTransfer = {
  id: string;
  tokenId: string;
  from: `0x${string}`;
  to: `0x${string}`;
  blockNumber: bigint;
  blockTimestamp: bigint;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
};
export type BaseContractEvent = Omit<
  BaseTransfer,
  "tokenId" | "from" | "to" | "blockTimestamp"
> & {
  eventName: string;
  args: Record<string, string>;
};
export type BaseCursor = {
  nextBlock: string;
  lastScannedBlock: string | null;
  lastScannedHash: string | null;
  finalizedBlock: string | null;
  finalizedHash: string | null;
  verifiedBlock: string | null;
  ready: boolean;
};

export async function readBaseCursor(
  pool: Pick<Pool, "query">
): Promise<BaseCursor> {
  const result =
    await pool.query<BaseCursor>(`SELECT next_block::text AS "nextBlock",
    last_scanned_block::text AS "lastScannedBlock",last_scanned_hash AS "lastScannedHash",
    finalized_block::text AS "finalizedBlock",finalized_hash AS "finalizedHash",
    verified_block::text AS "verifiedBlock",ready FROM ${schema}.sync_state WHERE singleton`);
  if (!result.rows[0]) throw new Error("base_islands_migration_required");
  return result.rows[0];
}

/** Each applied event is anchored to its canonical block and mint lifecycle. */
export async function applyBaseTransfers(
  client: Pick<PoolClient, "query">,
  events: BaseTransfer[]
) {
  if (!events.length) return;
  const existing = await client.query<{
    token_id: string;
    owner: string;
    burned: boolean;
    lifecycle: number;
    mint_block: string;
    mint_timestamp: string;
  }>(
    `SELECT token_id,owner,burned,lifecycle,mint_block::text,mint_timestamp::text
    FROM ${schema}.token WHERE token_id=ANY($1::text[])`,
    [[...new Set(events.map((e) => e.tokenId))]]
  );
  const states = new Map<string, TokenState>(
    existing.rows.map((row) => [
      row.token_id,
      {
        owner: row.owner,
        burned: row.burned,
        lifecycle: row.lifecycle,
        mintBlock: BigInt(row.mint_block),
        mintTimestamp: BigInt(row.mint_timestamp)
      }
    ])
  );
  const seen = await client.query<{ id: string }>(
    `SELECT id FROM ${schema}.transfer_event
    WHERE id=ANY($1::text[])`,
    [events.map((e) => e.id)]
  );
  const ids = new Set(seen.rows.map((row) => row.id));
  for (const event of events) {
    if (ids.has(event.id)) continue;
    const prior = states.get(event.tokenId) ?? null;
    if (
      event.from !== "0x0000000000000000000000000000000000000000" &&
      (!prior || prior.burned || prior.owner !== event.from)
    )
      throw new Error("base_islands_transfer_owner_mismatch");
    if (
      event.from === "0x0000000000000000000000000000000000000000" &&
      prior &&
      !prior.burned
    )
      throw new Error("base_islands_duplicate_mint");
    const state = transferState(prior, event.from, event.to, {
      number: event.blockNumber,
      timestamp: event.blockTimestamp
    });
    if (state.isMint)
      await client.query(
        `INSERT INTO ${schema}.token_lifecycle
      (collection,token_id,lifecycle,minted_to,mint_block,mint_timestamp,mint_transaction_hash)
      VALUES('base-islands',$1,$2,$3,$4,$5,$6)`,
        [
          event.tokenId,
          state.lifecycle,
          event.to,
          String(event.blockNumber),
          String(event.blockTimestamp),
          event.transactionHash
        ]
      );
    if (state.isBurn)
      await client.query(
        `UPDATE ${schema}.token_lifecycle SET
      burned_at_block=$3,burned_at_timestamp=$4,burn_transaction_hash=$5
      WHERE token_id=$1 AND lifecycle=$2`,
        [
          event.tokenId,
          state.lifecycle,
          String(event.blockNumber),
          String(event.blockTimestamp),
          event.transactionHash
        ]
      );
    await client.query(
      `INSERT INTO ${schema}.token
      (collection,token_id,chain_id,contract_address,owner,burned,lifecycle,mint_block,mint_timestamp,
       last_transfer_block,last_transfer_timestamp,last_transaction_hash)
      VALUES('base-islands',$1,8453,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(collection,token_id) DO UPDATE SET owner=EXCLUDED.owner,burned=EXCLUDED.burned,
      lifecycle=EXCLUDED.lifecycle,mint_block=EXCLUDED.mint_block,mint_timestamp=EXCLUDED.mint_timestamp,
      last_transfer_block=EXCLUDED.last_transfer_block,last_transfer_timestamp=EXCLUDED.last_transfer_timestamp,
      last_transaction_hash=EXCLUDED.last_transaction_hash`,
      [
        event.tokenId,
        collection.address,
        state.owner,
        state.burned,
        state.lifecycle,
        String(state.mintBlock),
        String(state.mintTimestamp),
        String(event.blockNumber),
        String(event.blockTimestamp),
        event.transactionHash
      ]
    );
    await client.query(
      `INSERT INTO ${schema}.transfer_event
      (id,collection,chain_id,contract_address,token_id,lifecycle,"from","to",block_number,block_hash,
       block_timestamp,transaction_hash,transaction_index,log_index)
      VALUES($1,'base-islands',8453,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        event.id,
        collection.address,
        event.tokenId,
        state.lifecycle,
        event.from,
        event.to,
        String(event.blockNumber),
        event.blockHash,
        String(event.blockTimestamp),
        event.transactionHash,
        event.transactionIndex,
        event.logIndex
      ]
    );
    states.set(event.tokenId, state);
    ids.add(event.id);
  }
}

export async function applyBaseRange(
  pool: Pick<Pool, "connect">,
  from: bigint,
  end: { number: bigint; hash: string },
  transfers: BaseTransfer[],
  contractEvents: BaseContractEvent[]
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cursor = await client.query<{
      next_block: string;
    }>(`SELECT next_block::text
      FROM ${schema}.sync_state WHERE singleton FOR UPDATE`);
    if (BigInt(cursor.rows[0]!.next_block) !== from)
      throw new Error("base_islands_cursor_changed");
    await applyBaseTransfers(client, transfers);
    for (const event of contractEvents)
      await client.query(
        `INSERT INTO ${schema}.contract_event
      (id,event_name,args,block_number,block_hash,transaction_hash,transaction_index,log_index)
      VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [
          event.id,
          event.eventName,
          JSON.stringify(event.args),
          String(event.blockNumber),
          event.blockHash,
          event.transactionHash,
          event.transactionIndex,
          event.logIndex
        ]
      );
    await client.query(
      `UPDATE ${schema}.sync_state SET next_block=$1,last_scanned_block=$2,
      last_scanned_hash=$3,last_error=NULL,updated_at=now(),
      contract_owner=(SELECT args->>'newOwner' FROM ${schema}.contract_event WHERE event_name='OwnershipTransferred'
        ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1),
      airdrop_finalized=EXISTS(SELECT 1 FROM ${schema}.contract_event WHERE event_name='AirdropFinalized')
      WHERE singleton`,
      [String(end.number + 1n), String(end.number), end.hash]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** A reorg replays only retained Base events; the finalized anchor must be checked by the caller. */
export async function rewindBaseToFinalized(
  pool: Pick<Pool, "connect">,
  anchor: { number: bigint; hash: string }
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT singleton FROM ${schema}.sync_state WHERE singleton FOR UPDATE`
    );
    await client.query(
      `DELETE FROM ${schema}.transfer_event WHERE block_number>$1`,
      [String(anchor.number)]
    );
    await client.query(
      `DELETE FROM ${schema}.contract_event WHERE block_number>$1`,
      [String(anchor.number)]
    );
    const retained =
      await client.query(`SELECT id,token_id AS "tokenId","from","to",
      block_number::text AS "blockNumber",block_timestamp::text AS "blockTimestamp",block_hash AS "blockHash",
      transaction_hash AS "transactionHash",transaction_index AS "transactionIndex",log_index AS "logIndex"
      FROM ${schema}.transfer_event ORDER BY block_number,transaction_index,log_index`);
    await client.query(`DELETE FROM ${schema}.transfer_event`);
    await client.query(`DELETE FROM ${schema}.token_lifecycle`);
    await client.query(`DELETE FROM ${schema}.token`);
    await applyBaseTransfers(
      client,
      retained.rows.map((row) => ({
        ...row,
        blockNumber: BigInt(row.blockNumber),
        blockTimestamp: BigInt(row.blockTimestamp)
      })) as BaseTransfer[]
    );
    await client.query(
      `UPDATE ${schema}.sync_state SET next_block=$1,last_scanned_block=$2,
      last_scanned_hash=$3,verified_block=NULL,verified_hash=NULL,ready=false,
      contract_owner=(SELECT args->>'newOwner' FROM ${schema}.contract_event WHERE event_name='OwnershipTransferred'
        ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1),
      airdrop_finalized=EXISTS(SELECT 1 FROM ${schema}.contract_event WHERE event_name='AirdropFinalized'),
      updated_at=now() WHERE singleton`,
      [String(anchor.number + 1n), String(anchor.number), anchor.hash]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function baseIslandsReadiness(pool: Pick<Pool, "query">) {
  const result =
    await pool.query(`SELECT ready AND verified_block IS NOT NULL AND
    last_scanned_block>=verified_block AND completed_at>now()-interval '15 minutes' AS ready,
    last_scanned_block::text AS "indexedBlock",verified_block::text AS "verifiedBlock",
    finalized_block::text AS "finalizedBlock",updated_at AS "updatedAt",completed_at AS "completedAt",last_error AS reason,
    airdrop_finalized AS "airdropFinalized",contract_owner AS "contractOwner"
    FROM ${schema}.sync_state WHERE singleton`);
  return {
    ...result.rows[0],
    ready: result.rows[0]?.ready === true,
    buildId: baseWorkerVersion
  };
}
