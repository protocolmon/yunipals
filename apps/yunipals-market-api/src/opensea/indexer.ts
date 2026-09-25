import type { Pool } from "pg";
import { getAddress, type Address, type Hex } from "viem";
import {
  address,
  decimal,
  hex,
  integer
} from "@protopals/yunipals-market-core/validation";

import { OpenSeaOrderError, type OpenSeaOrderRequest } from "@/opensea/orders";
import { indexedTokenHiddenSql } from "@/reads/visibility";

export type IndexedOpenSeaAsset = {
  owner: Address;
  lifecycle: number;
  hidden: boolean;
  burned: boolean;
  checkpoint: { number: bigint; timestamp: bigint; heartbeatAt: number };
  mint: { blockNumber: bigint; transactionHash: Hex; recipient: Address };
  lastTransfer: {
    blockNumber: bigint;
    transactionHash: Hex;
    transactionIndex: number;
    logIndex: number;
    from: Address;
    to: Address;
  };
};

// The deployed Ponder metadata v6 checkpoint carries height/time, not a hash.
// Admission independently binds the asset's retained event receipts to canonical
// RPC blocks and checks subsequent transfers; it never fabricates a stored hash.
export async function readIndexedOpenSeaAsset(
  pool: Pick<Pool, "query">,
  asset: OpenSeaOrderRequest["asset"]
): Promise<IndexedOpenSeaAsset> {
  const result = await pool.query<{
    owner: string;
    lifecycle: number;
    hidden: boolean;
    burned: boolean;
    mint_block: string;
    last_transfer_block: string;
    last_transaction_hash: string;
    minted_to: string | null;
    mint_transaction_hash: string | null;
    lifecycle_mint_block: string | null;
    event_lifecycle: number | null;
    event_block: string | null;
    event_hash: string | null;
    event_transaction_index: number | null;
    event_log_index: number | null;
    event_from: string | null;
    event_to: string | null;
    latest_checkpoint: string;
    metadata_version: string | null;
    is_ready: string | null;
    heartbeat_at: string | null;
  }>(
    `SELECT t.owner,t.lifecycle,t.burned,${indexedTokenHiddenSql} AS hidden,
    t.mint_block::text,t.last_transfer_block::text,t.last_transaction_hash,
    l.minted_to,l.mint_transaction_hash,l.mint_block::text AS lifecycle_mint_block,
    e.lifecycle AS event_lifecycle,e.block_number::text AS event_block,e.transaction_hash AS event_hash,
    e.transaction_index AS event_transaction_index,e.log_index AS event_log_index,e."from" AS event_from,e."to" AS event_to,
    c.latest_checkpoint,m.value->>'version' AS metadata_version,m.value->>'is_ready' AS is_ready,m.value->>'heartbeat_at' AS heartbeat_at
    FROM yunipals_read_v4.token t
    JOIN yunipals_indexer_v3._ponder_checkpoint c ON c.chain_id=t.chain_id
    JOIN yunipals_indexer_v3._ponder_meta m ON m.key='app'
    LEFT JOIN yunipals_read_v4.token_lifecycle l ON l.collection=t.collection AND l.token_id=t.token_id AND l.lifecycle=t.lifecycle
    LEFT JOIN LATERAL (SELECT * FROM yunipals_read_v4.transfer_event x WHERE x.collection=t.collection AND x.token_id=t.token_id
      ORDER BY x.block_number DESC,x.transaction_index DESC,x.log_index DESC LIMIT 1) e ON true
    WHERE t.collection=$1 AND t.chain_id=$2 AND lower(t.contract_address)=$3 AND t.token_id=$4`,
    [
      asset.chain,
      asset.chainId,
      asset.contractAddress.toLowerCase(),
      asset.tokenId
    ]
  );
  if (result.rowCount !== 1)
    throw new OpenSeaOrderError("asset_not_indexed", 503);
  try {
    const row = result.rows[0]!;
    if (
      row.metadata_version !== "6" ||
      row.is_ready !== "1" ||
      !/^[0-9]{75}$/.test(row.latest_checkpoint)
    )
      throw new Error();
    const checkpoint = {
      timestamp: BigInt(row.latest_checkpoint.slice(0, 10)),
      number: BigInt(row.latest_checkpoint.slice(26, 42)),
      heartbeatAt: Number(row.heartbeat_at)
    };
    if (
      BigInt(row.latest_checkpoint.slice(10, 26)) !== BigInt(asset.chainId) ||
      row.heartbeat_at === null ||
      !Number.isSafeInteger(checkpoint.heartbeatAt)
    )
      throw new Error();
    const owner = address(row.owner);
    const lifecycle = integer(row.lifecycle, 2147483647);
    if (
      lifecycle < 1 ||
      row.event_lifecycle !== lifecycle ||
      row.lifecycle_mint_block !== row.mint_block ||
      row.event_block !== row.last_transfer_block ||
      row.event_hash?.toLowerCase() !==
        row.last_transaction_hash.toLowerCase() ||
      address(row.event_to) !== owner ||
      typeof row.hidden !== "boolean" ||
      typeof row.burned !== "boolean"
    )
      throw new Error();
    const lastTransfer = {
      blockNumber: BigInt(decimal(row.event_block)),
      transactionHash: hex(row.event_hash, 32),
      transactionIndex: integer(row.event_transaction_index),
      logIndex: integer(row.event_log_index),
      from: address(row.event_from),
      to: owner
    };
    const mint = {
      blockNumber: BigInt(decimal(row.mint_block)),
      transactionHash: hex(row.mint_transaction_hash, 32),
      recipient: getAddress(address(row.minted_to))
    };
    if (
      mint.blockNumber > lastTransfer.blockNumber ||
      lastTransfer.blockNumber > checkpoint.number
    )
      throw new Error();
    return {
      owner,
      lifecycle,
      hidden: row.hidden,
      burned: row.burned,
      checkpoint,
      mint,
      lastTransfer
    };
  } catch {
    throw new OpenSeaOrderError("indexer_unavailable", 503);
  }
}
