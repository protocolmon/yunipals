import type { PoolClient } from "pg";

export const indexedTransferBatchSize = 100;

export type IndexedTransfer = {
  tokenId: string;
  lifecycle: number;
  transactionHash: string;
};

// Keep the token identifiers as a query parameter. postgres_fdw can push this
// exact batch into the live indexer's (collection, token_id) primary key; a
// join against a local order row instead downloads the complete collection.
export async function readIndexedTransfers(
  db: PoolClient,
  collection: string,
  tokenIds: readonly string[]
) {
  const unique = [...new Set(tokenIds)];
  if (unique.length === 0) return new Map<string, IndexedTransfer>();
  if (unique.length > indexedTransferBatchSize)
    throw new Error("Indexed transfer batch is too large.");
  const result = await db.query<{
    token_id: string;
    lifecycle: number;
    last_transaction_hash: string;
  }>(
    `SELECT token_id,lifecycle,last_transaction_hash
    FROM yunipals_read_v4.token
    WHERE collection=$1 AND token_id=ANY($2::text[])`,
    [collection, unique]
  );
  return new Map(
    result.rows.map((row) => [
      row.token_id,
      {
        tokenId: row.token_id,
        lifecycle: row.lifecycle,
        transactionHash: row.last_transaction_hash.toLowerCase()
      }
    ])
  );
}
