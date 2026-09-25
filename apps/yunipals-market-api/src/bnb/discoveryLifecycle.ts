import type { Pool } from "pg";
import { getAddress, zeroAddress, type Hex, type PublicClient } from "viem";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";

import {
  bnbOrderSummary,
  checkBnbOrder,
  parseBnbOrderRequest,
  type BnbPolicy
} from "@/bnb/orders";

type UnboundOrder = {
  order_hash: Hex;
  token_id: string;
  publication_block: string;
  publication_transaction_index: number;
  publication_log_index: number;
  published_components: unknown;
};

/** Bind a published order to the NFT lifecycle at its event position. */
export async function bindDiscoveredBnbLifecycles(
  pool: Pool,
  stateClient: PublicClient,
  policy: BnbPolicy,
  finalizedBlock: bigint,
  limit = 100
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid BNB lifecycle batch size.");
  const checkpoint = await pool.query<{
    last_scanned_block: string | null;
    last_scanned_hash: Hex | null;
    updated_at: Date;
    caught_up_at: Date | null;
    last_error: string | null;
  }>(
    `SELECT last_scanned_block::text,last_scanned_hash,updated_at,
     caught_up_at,last_error FROM bnb_indexer.sync_state WHERE singleton`
  );
  const sync = checkpoint.rows[0];
  if (
    !sync ||
    !sync.caught_up_at ||
    sync.last_error !== null ||
    !sync.last_scanned_block ||
    !sync.last_scanned_hash ||
    Date.now() - sync.updated_at.getTime() > 720_000 ||
    sync.updated_at.getTime() > Date.now() + 30_000
  )
    return { bound: 0, pending: true };
  const indexerBlock = BigInt(sync.last_scanned_block);
  const anchor = await stateClient.getBlock({ blockNumber: indexerBlock });
  if (anchor.hash?.toLowerCase() !== sync.last_scanned_hash.toLowerCase())
    throw new Error("BNB lifecycle indexer anchor changed.");

  const due = await pool.query<UnboundOrder>(
    `SELECT order_hash,token_id::text,publication_block::text,
     publication_transaction_index,publication_log_index,published_components
     FROM yunipals_market.bnb_discovered_order
     WHERE bound_lifecycle IS NULL AND published_components IS NOT NULL
       AND publication_transaction_index IS NOT NULL
       AND publication_block<=$1::numeric
       AND publication_block<=$2::numeric
       AND end_time>extract(epoch FROM clock_timestamp())
     ORDER BY publication_block,publication_log_index LIMIT $3`,
    [finalizedBlock.toString(), indexerBlock.toString(), limit]
  );
  let bound = 0;
  for (const row of due.rows) {
    const transfer = await pool.query<{
      lifecycle: number;
      to: string;
    }>(
      `SELECT lifecycle,"to" FROM yunipals_read_v4.transfer_event
       WHERE collection='bnb' AND token_id=$1
         AND (block_number<$2::numeric OR
           (block_number=$2::numeric AND
             (transaction_index<$3 OR
               (transaction_index=$3 AND log_index<$4))))
       ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1`,
      [
        row.token_id,
        row.publication_block,
        row.publication_transaction_index,
        row.publication_log_index
      ]
    );
    const lifecycle = transfer.rows[0]?.lifecycle;
    const recipient = transfer.rows[0]?.to;
    if (
      !Number.isSafeInteger(lifecycle) ||
      lifecycle === undefined ||
      lifecycle < 0 ||
      !recipient ||
      getAddress(recipient) === zeroAddress
    )
      continue;
    const input = parseBnbOrderRequest({
      asset: {
        chain: "bnb",
        chainId: 56,
        contractAddress: marketplaceChains.bnb.contractAddress,
        tokenId: row.token_id
      },
      lifecycle,
      order: row.published_components
    });
    if (input.hash.toLowerCase() !== row.order_hash.toLowerCase())
      throw new Error("Published BNB components changed after verification.");
    const summary = bnbOrderSummary(
      input,
      checkBnbOrder(input, policy),
      "unavailable"
    );
    const saved = await pool.query(
      `UPDATE yunipals_market.bnb_discovered_order
       SET bound_lifecycle=$3,summary=$4::jsonb,bound_at=clock_timestamp(),
         bound_indexer_block=$5,bound_indexer_hash=$6
       WHERE protocol_address=$1 AND order_hash=$2 AND bound_lifecycle IS NULL`,
      [
        seaportDeployment.address.toLowerCase(),
        row.order_hash.toLowerCase(),
        lifecycle,
        JSON.stringify(summary),
        indexerBlock.toString(),
        sync.last_scanned_hash.toLowerCase()
      ]
    );
    if (saved.rowCount === 1) bound++;
  }
  return { bound, pending: due.rows.length === limit };
}
