import type { PoolClient } from "pg";

export type LegacyReceiptSelection = { consumer: string; epoch: string };

/** Called only after the compatible scanner has fetched and validated this
 * receipt under its fresh canonical/depth checks, inside its fenced commit. */
export async function storeLegacyQualifiedReceipt(
  db: PoolClient,
  proof: {
    chainId: number;
    blockHash: string;
    transactionHash: string;
    receipt: string;
    block: string;
    policy: string;
  },
  selection: LegacyReceiptSelection
) {
  const retained = await db.query(
    `INSERT INTO yunipals_market.sale_receipt
      (chain_id,block_hash,transaction_hash,receipt,block,confirmation_policy)
    SELECT $1::integer,$2::text,$3::text,$4::jsonb,$5::jsonb,$6::text
      FROM yunipals_market.marketplace_legacy_selection l
      JOIN yunipals_market.checkpoint c ON c.source='chain' AND c.chain_id=l.chain_id
        AND c.name=CASE WHEN l.consumer='bnb-sales' THEN 'bnb-sales' ELSE 'seaport-sales' END
        AND c.reader_mode='legacy'
      WHERE l.consumer=$7 AND l.epoch=$8 AND l.chain_id=$1 AND l.policy=$6
    ON CONFLICT(chain_id,block_hash,transaction_hash) DO UPDATE SET receipt=yunipals_market.sale_receipt.receipt
      WHERE yunipals_market.sale_receipt.receipt=EXCLUDED.receipt AND yunipals_market.sale_receipt.block=EXCLUDED.block
    RETURNING chain_id`,
    [
      proof.chainId,
      proof.blockHash.toLowerCase(),
      proof.transactionHash.toLowerCase(),
      proof.receipt,
      proof.block,
      proof.policy,
      selection.consumer,
      selection.epoch
    ]
  );
  if (retained.rowCount !== 1)
    throw new Error(
      "Legacy receipt differs from retained proof or selected epoch."
    );
  const qualified = await db.query(
    `INSERT INTO yunipals_market.legacy_sale_receipt_qualification
      (consumer,epoch,chain_id,block_hash,transaction_hash,policy,proof_hash)
    SELECT $1::text,$2::text,r.chain_id,r.block_hash,r.transaction_hash,$6::text,
      '0x'||encode(sha256(convert_to(jsonb_build_object('receipt',r.receipt,'block',r.block)::text,'UTF8')),'hex')
      FROM yunipals_market.sale_receipt r WHERE r.chain_id=$3 AND r.block_hash=$4 AND r.transaction_hash=$5
    ON CONFLICT(epoch,chain_id,block_hash,transaction_hash) DO UPDATE SET qualified_at=clock_timestamp()
      WHERE yunipals_market.legacy_sale_receipt_qualification.proof_hash=EXCLUDED.proof_hash RETURNING chain_id`,
    [
      selection.consumer,
      selection.epoch,
      proof.chainId,
      proof.blockHash.toLowerCase(),
      proof.transactionHash.toLowerCase(),
      proof.policy
    ]
  );
  if (qualified.rowCount !== 1)
    throw new Error(
      "Legacy receipt requalification conflicts with retained evidence."
    );
}
