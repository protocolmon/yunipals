import type { Pool } from "pg";

export type StoredAnchor = { number: string; hash: string; timestamp: string };
export type ChainStatusRow = {
  revision: string;
  head_number: string | null;
  head_hash: string | null;
  head_timestamp: string | null;
  finalized_number: string | null;
  finalized_hash: string | null;
  witness_number: string | null;
  witness_hash: string | null;
  observed_at_ms: string | null;
  provider_id: string | null;
  anchors: Record<string, StoredAnchor>;
  halted: boolean;
  error_code: string | null;
  finality_error_code: string | null;
};

export async function readChainStatus(
  db: { query: Pool["query"] },
  releaseId: string,
  chainId: number
): Promise<ChainStatusRow | null> {
  return (
    (
      await db.query<ChainStatusRow>(
        `SELECT revision::text,head_number::text,head_hash,head_timestamp::text,
    finalized_number::text,finalized_hash,witness_number::text,witness_hash,
    observed_at_ms::text,provider_id,anchors,halted,error_code,finality_error_code
    FROM yunipals_indexer_control.chain_status WHERE release_id=$1 AND chain_id=$2`,
        [releaseId, chainId]
      )
    ).rows[0] ?? null
  );
}
