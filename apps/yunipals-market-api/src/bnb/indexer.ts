import type { Pool } from "pg";
import { getAddress, type Address, type Hex } from "viem";

import { BnbOrderError, type BnbAsset } from "@/bnb/orders";
import { indexedTokenHiddenSql } from "@/reads/visibility";

export type IndexedBnbAsset = {
  owner: Address;
  lifecycle: number;
  hidden: boolean;
  burned: boolean;
  lastTransfer: { blockNumber: bigint; transactionHash: Hex };
  checkpoint: { number: bigint; hash: Hex; updatedAt: Date };
};

export async function readIndexedBnbAsset(
  pool: Pool,
  asset: BnbAsset
): Promise<IndexedBnbAsset> {
  const result = await pool.query<{
    owner: string;
    lifecycle: number;
    hidden: boolean;
    burned: boolean;
    last_transfer_block: string;
    last_transaction_hash: string;
    last_scanned_block: string | null;
    last_scanned_hash: Hex | null;
    updated_at: Date;
    caught_up: boolean;
    has_error: boolean;
  }>(
    `SELECT t.owner,t.lifecycle,t.burned,t.last_transfer_block::text,t.last_transaction_hash,
    ${indexedTokenHiddenSql} AS hidden,
    s.last_scanned_block::text,s.last_scanned_hash,s.updated_at,
    s.caught_up_at IS NOT NULL AS caught_up,s.last_error IS NOT NULL AS has_error
    FROM yunipals_read_v4.token t CROSS JOIN bnb_indexer.sync_state s
    WHERE t.collection='bnb' AND t.chain_id=56 AND lower(t.contract_address)=$1
      AND t.token_id=$2 AND s.singleton`,
    [asset.contractAddress.toLowerCase(), asset.tokenId]
  );
  if (result.rowCount !== 1) throw new BnbOrderError("asset_not_indexed", 503);
  const row = result.rows[0]!;
  if (
    !row.caught_up ||
    row.has_error ||
    row.last_scanned_block === null ||
    !row.last_scanned_hash ||
    !Number.isSafeInteger(row.lifecycle) ||
    row.lifecycle < 0 ||
    !/^(0|[1-9][0-9]*)$/.test(row.last_transfer_block) ||
    !/^0x[0-9a-fA-F]{64}$/.test(row.last_transaction_hash) ||
    !Number.isFinite(row.updated_at.getTime())
  )
    throw new BnbOrderError("indexer_unavailable", 503);
  return {
    owner: getAddress(row.owner),
    lifecycle: row.lifecycle,
    hidden: row.hidden,
    burned: row.burned,
    lastTransfer: {
      blockNumber: BigInt(row.last_transfer_block),
      transactionHash: row.last_transaction_hash.toLowerCase() as Hex
    },
    checkpoint: {
      number: BigInt(row.last_scanned_block),
      hash: row.last_scanned_hash,
      updatedAt: row.updated_at
    }
  };
}
