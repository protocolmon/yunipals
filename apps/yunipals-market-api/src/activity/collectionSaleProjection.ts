import type { PoolClient } from "pg";
import type { Hex } from "viem";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import type { ObservedMarketSale } from "@protopals/yunipals-market-core/settledSale";
import {
  storeLegacyQualifiedReceipt,
  type LegacyReceiptSelection
} from "./legacyReceiptQualification";
const protocol = seaportDeployment.address.toLowerCase();
export const saleProofJson = (value: unknown) =>
  JSON.stringify(value, (_, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item
  );
const json = saleProofJson;
export type CollectionSaleProof = {
  receipt: string;
  block: string;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
  sale: ObservedMarketSale | null;
};
export async function storeCollectionReceipt(
  db: PoolClient,
  chainId: number,
  proof: CollectionSaleProof,
  policy: string,
  legacySelection?: LegacyReceiptSelection
) {
  if (legacySelection) {
    return storeLegacyQualifiedReceipt(
      db,
      {
        chainId,
        blockHash: proof.blockHash,
        transactionHash: proof.transactionHash,
        receipt: proof.receipt,
        block: proof.block,
        policy
      },
      legacySelection
    );
  }
  const result = await db.query(
    `INSERT INTO yunipals_market.sale_receipt(chain_id,block_hash,transaction_hash,receipt,block,confirmation_policy)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(chain_id,block_hash,transaction_hash) DO UPDATE SET receipt=yunipals_market.sale_receipt.receipt
      WHERE yunipals_market.sale_receipt.receipt=EXCLUDED.receipt AND yunipals_market.sale_receipt.block=EXCLUDED.block
        AND yunipals_market.sale_receipt.confirmation_policy=EXCLUDED.confirmation_policy RETURNING chain_id`,
    [
      chainId,
      proof.blockHash.toLowerCase(),
      proof.transactionHash.toLowerCase(),
      proof.receipt,
      proof.block,
      policy
    ]
  );
  if (result.rowCount !== 1)
    throw new Error("Retained receipt conflicts with replay.");
}
export async function storeCollectionSale(
  db: PoolClient,
  chainId: number,
  proof: CollectionSaleProof
) {
  if (!proof.sale) {
    const excluded = await db.query(
      `INSERT INTO yunipals_market.sale_exclusion(chain_id,block_number,block_hash,log_index,transaction_hash,reason,canonical)
        VALUES($1,$2,$3,$4,$5,'unsupported_collection_sale',true) ON CONFLICT(chain_id,block_hash,log_index) DO UPDATE SET canonical=true
        WHERE yunipals_market.sale_exclusion.block_number=EXCLUDED.block_number
          AND yunipals_market.sale_exclusion.transaction_hash=EXCLUDED.transaction_hash
          AND yunipals_market.sale_exclusion.reason=EXCLUDED.reason RETURNING chain_id`,
      [
        chainId,
        proof.blockNumber.toString(),
        proof.blockHash.toLowerCase(),
        proof.logIndex,
        proof.transactionHash.toLowerCase()
      ]
    );
    if (excluded.rowCount !== 1)
      throw new Error("Retained exclusion conflicts with replay.");
    return;
  }
  const sale = proof.sale;
  const saved = await db.query(
    `INSERT INTO yunipals_market.sale(chain_id,block_number,block_hash,log_index,transaction_hash,protocol_address,
      order_hash,contract_address,token_id,seller,nft_recipient,observation,canonical,block_timestamp)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,to_timestamp($13))
      ON CONFLICT(chain_id,block_hash,log_index) DO UPDATE SET canonical=true WHERE yunipals_market.sale.observation=EXCLUDED.observation RETURNING chain_id`,
    [
      chainId,
      sale.blockNumber,
      sale.blockHash.toLowerCase(),
      sale.fulfillmentLogIndex,
      sale.transactionHash.toLowerCase(),
      protocol,
      sale.orderHash.toLowerCase(),
      sale.asset.contractAddress.toLowerCase(),
      sale.asset.tokenId,
      sale.seller.toLowerCase(),
      sale.nftRecipient.toLowerCase(),
      json(sale),
      sale.blockTimestamp
    ]
  );
  if (saved.rowCount !== 1)
    throw new Error("Retained sale conflicts with replay.");
}

export async function qualifySharedCollectionReceipt(
  db: PoolClient,
  chainId: number,
  proof: CollectionSaleProof,
  policy: string,
  source: {
    consumer: string;
    releaseId: string;
    sourceId: string;
    eventId: string;
    payloadHash: string;
  }
) {
  const retained = await db.query(
    `INSERT INTO yunipals_market.sale_receipt(chain_id,block_hash,transaction_hash,receipt,block,confirmation_policy)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(chain_id,block_hash,transaction_hash)
     DO UPDATE SET receipt=yunipals_market.sale_receipt.receipt
     WHERE yunipals_market.sale_receipt.receipt=EXCLUDED.receipt
       AND yunipals_market.sale_receipt.block=EXCLUDED.block RETURNING chain_id`,
    [
      chainId,
      proof.blockHash.toLowerCase(),
      proof.transactionHash.toLowerCase(),
      proof.receipt,
      proof.block,
      policy
    ]
  );
  if (retained.rowCount !== 1)
    throw new Error("Shared receipt conflicts with retained sale proof.");
  const saved = await db.query(
    `INSERT INTO yunipals_market.sale_receipt_qualification
      (chain_id,block_hash,transaction_hash,policy,consumer,release_id,source_id,event_id,proof_hash,source_payload_hash)
     SELECT $1::integer,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,
       '0x'||encode(sha256(convert_to(jsonb_build_object('receipt',r.receipt,'block',r.block)::text,'UTF8')),'hex'),$9::text
       FROM yunipals_market.sale_receipt r WHERE r.chain_id=$1 AND r.block_hash=$2 AND r.transaction_hash=$3
     ON CONFLICT(chain_id,block_hash,transaction_hash,policy) DO UPDATE SET
       consumer=EXCLUDED.consumer,release_id=EXCLUDED.release_id,source_id=EXCLUDED.source_id,
       event_id=EXCLUDED.event_id,source_payload_hash=EXCLUDED.source_payload_hash,qualified_at=clock_timestamp()
     WHERE yunipals_market.sale_receipt_qualification.proof_hash=EXCLUDED.proof_hash RETURNING chain_id`,
    [
      chainId,
      proof.blockHash.toLowerCase(),
      proof.transactionHash.toLowerCase(),
      policy,
      source.consumer,
      source.releaseId,
      source.sourceId,
      source.eventId,
      source.payloadHash
    ]
  );
  if (saved.rowCount !== 1)
    throw new Error(
      "Shared receipt qualification conflicts with retained evidence."
    );
}

export async function wakeSaleOrderProjection(
  db: PoolClient,
  chainId: number,
  sale: ObservedMarketSale
) {
  for (const table of ["orders", "opensea_discovered_state"])
    await db.query(
      `UPDATE yunipals_market.${table} SET next_reconcile_at=least(next_reconcile_at,clock_timestamp())
        WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3`,
      [chainId, protocol, sale.orderHash.toLowerCase()]
    );
}

export async function wakeReorgedSaleOrders(
  db: PoolClient,
  chainId: number,
  retained: bigint | null
) {
  for (const table of ["orders", "opensea_discovered_state"])
    await db.query(
      `UPDATE yunipals_market.${table} projection
        SET next_reconcile_at=least(projection.next_reconcile_at,clock_timestamp())
        FROM (SELECT DISTINCT order_hash FROM yunipals_market.sale
          WHERE chain_id=$1 AND protocol_address=$2 AND canonical
            AND ($3::numeric IS NULL OR block_number>$3::numeric)) affected
        WHERE projection.chain_id=$1 AND projection.protocol_address=$2
          AND projection.order_hash=affected.order_hash`,
      [chainId, protocol, retained?.toString() ?? null]
    );
}
