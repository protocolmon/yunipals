import type { Pool } from "pg";
import { islandCollection, ZERO_ADDRESS } from "../constants.js";
import { sqlIdentifier } from "../offchain/sql.js";
import { canonicalTokenId } from "./metadata.js";
import { ethereumCheckpointBlock } from "./readiness.js";
import { islandIdentityPredicate, islandTokenRelation } from "./queries.js";

export type IslandChainReader = {
  finalizedBlock: () => Promise<{ number: bigint; hash: string }>;
  blockHash: (block: bigint) => Promise<string>;
  totalSupply: (block: bigint) => Promise<bigint>;
  tokenIds: (offset: number, count: number, block: bigint) => Promise<bigint[]>;
  owners: (tokenIds: bigint[], block: bigint) => Promise<string[]>;
};

export async function verifyIslandsOwnership(
  pool: Pick<Pool, "connect" | "query">,
  schemaName: string,
  chain: IslandChainReader,
  activate = false
) {
  const schema = sqlIdentifier(schemaName);
  const block = await chain.finalizedBlock();
  if (block.number < BigInt(islandCollection.deploymentBlock))
    throw new Error("islands_not_deployed");
  const supply = await chain.totalSupply(block.number);
  if (supply < 0n || supply > 100_000n)
    throw new Error("islands_supply_out_of_verification_bounds");
  const expected = new Map<string, string>();
  for (let offset = 0; offset < Number(supply); offset += 40) {
    const count = Math.min(40, Number(supply) - offset);
    const ids = await chain.tokenIds(offset, count, block.number);
    const owners = await chain.owners(ids, block.number);
    if (ids.length !== count || owners.length !== count)
      throw new Error("incomplete_island_enumeration");
    for (const [index, id] of ids.entries()) {
      const tokenId = id.toString(),
        owner = owners[index]!.toLowerCase();
      if (
        !canonicalTokenId(tokenId) ||
        expected.has(tokenId) ||
        !/^0x[0-9a-f]{40}$/.test(owner) ||
        owner === ZERO_ADDRESS
      ) {
        throw new Error("invalid_island_enumeration");
      }
      expected.set(tokenId, owner);
    }
  }
  const client = await pool.connect();
  let metadataAvailable = 0;
  let buildId: string | undefined;
  try {
    await client.query(
      `BEGIN ISOLATION LEVEL REPEATABLE READ${activate ? "" : " READ ONLY"}`
    );
    const checkpoint = (
      await client.query<{ latest_checkpoint: string }>(
        `SELECT latest_checkpoint FROM ${schema}._ponder_checkpoint WHERE chain_id=1`
      )
    ).rows[0]?.latest_checkpoint;
    const indexedBlock = ethereumCheckpointBlock(checkpoint);
    const indexing = (
      await client.query<{ ready: string; buildId: string }>(
        `SELECT value->>'is_ready' AS ready,value->>'build_id' AS "buildId" FROM ${schema}._ponder_meta WHERE key='app'`
      )
    ).rows[0];
    buildId = indexing?.buildId;
    if (
      indexing?.ready !== "1" ||
      !buildId ||
      indexedBlock === null ||
      indexedBlock < block.number
    )
      throw new Error("islands_backfill_pending");
    const indexed = (
      await client.query<{ tokenId: string; owner: string }>(
        `SELECT token_id AS "tokenId","to" AS owner FROM (
        SELECT DISTINCT ON(token_id) token_id,"to"
        FROM ${schema}.transfer_event WHERE collection=$1 AND chain_id=1 AND contract_address=$2
          AND block_number<=$3::numeric
        ORDER BY token_id,block_number DESC,transaction_index DESC,log_index DESC
      ) final_state WHERE "to"<>$4`,
        [
          islandCollection.slug,
          islandCollection.address,
          block.number.toString(),
          ZERO_ADDRESS
        ]
      )
    ).rows;
    if (
      indexed.length !== expected.size ||
      indexed.some((row) => expected.get(row.tokenId) !== row.owner)
    ) {
      throw new Error("islands_ownership_mismatch");
    }
    // Check the current mutable table as well as the reconstructed finalized
    // snapshot, including burns and tokens minted after the verification block.
    const inconsistent = (
      await client.query<{ count: number }>(
        `WITH latest AS (
      SELECT DISTINCT ON(token_id) token_id,lifecycle,"to",block_number,block_timestamp,transaction_hash
        FROM ${schema}.transfer_event WHERE collection=$1
        ORDER BY token_id,block_number DESC,transaction_index DESC,log_index DESC
      ) SELECT count(*)::int AS count FROM latest e FULL JOIN
        (SELECT * FROM ${schema}.token WHERE collection=$1) t ON t.token_id=e.token_id
      WHERE t.token_id IS NULL OR e.token_id IS NULL OR t.owner<>e."to"
        OR t.burned<>(e."to"=$2) OR t.lifecycle<>e.lifecycle
        OR t.chain_id<>1 OR t.contract_address<>$3
        OR t.last_transfer_block<>e.block_number OR t.last_transfer_timestamp<>e.block_timestamp
        OR t.last_transaction_hash<>e.transaction_hash`,
        [islandCollection.slug, ZERO_ADDRESS, islandCollection.address]
      )
    ).rows[0]!.count;
    if (inconsistent !== 0)
      throw new Error("islands_current_state_inconsistent");
    const invalidMint = (
      await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
      FROM ${schema}.token t LEFT JOIN ${schema}.token_lifecycle l ON l.collection=t.collection
        AND l.token_id=t.token_id AND l.lifecycle=t.lifecycle
      LEFT JOIN ${schema}.transfer_event mint ON mint.collection=l.collection AND mint.token_id=l.token_id
        AND mint.lifecycle=l.lifecycle AND mint.transaction_hash=l.mint_transaction_hash
        AND mint.block_number=l.mint_block AND mint."from"=$2
      WHERE t.collection=$1 AND (l.token_id IS NULL OR mint.id IS NULL
        OR l.mint_block<>t.mint_block OR l.mint_timestamp<>t.mint_timestamp OR l.minted_to<>mint."to"
        OR mint.chain_id<>1 OR mint.contract_address<>$3
        OR (t.burned AND (l.burned_at_block IS DISTINCT FROM t.last_transfer_block
          OR l.burned_at_timestamp IS DISTINCT FROM t.last_transfer_timestamp
          OR l.burn_transaction_hash IS DISTINCT FROM t.last_transaction_hash))
        OR (NOT t.burned AND l.burned_at_block IS NOT NULL))`,
        [islandCollection.slug, ZERO_ADDRESS, islandCollection.address]
      )
    ).rows[0]!.count;
    if (invalidMint !== 0) throw new Error("islands_mint_state_inconsistent");
    const metadata = (
      await client.query<{ tokenId: string }>(
        `SELECT t.token_id AS "tokenId" FROM ${islandTokenRelation(schemaName)}
        WHERE ${islandIdentityPredicate} AND p.status='published' AND r.revision_hash IS NOT NULL
          AND t.token_id=ANY($1::text[])`,
        [[...expected.keys()]]
      )
    ).rows;
    metadataAvailable = new Set(metadata.map((row) => row.tokenId)).size;
    if (activate && metadataAvailable !== expected.size)
      throw new Error("islands_metadata_publication_pending");
    if ((await chain.blockHash(block.number)) !== block.hash)
      throw new Error("islands_verification_block_changed");
    if (activate) {
      await client.query(
        `INSERT INTO metadata.island_verification
        (collection,schema_name,build_id,checkpoint_block,block_hash,active_supply)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(collection,schema_name,build_id) DO UPDATE SET
          checkpoint_block=EXCLUDED.checkpoint_block,block_hash=EXCLUDED.block_hash,
          active_supply=EXCLUDED.active_supply,verified_at=now()`,
        [
          islandCollection.slug,
          schemaName,
          buildId,
          block.number.toString(),
          block.hash,
          expected.size
        ]
      );
      await client.query(
        `INSERT INTO metadata.chain_readiness(collection,state,checkpoint_block,verified_at)
        VALUES($1,'ready',$2,now()) ON CONFLICT(collection) DO UPDATE SET
          state='ready',checkpoint_block=EXCLUDED.checkpoint_block,reason=NULL,
          updated_at=now(),verified_at=now()`,
        [islandCollection.slug, block.number.toString()]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return {
    format: "yunipals-islands-verification-v1",
    collectionId: islandCollection.slug,
    chainId: islandCollection.chainId,
    contractAddress: islandCollection.address,
    schemaName,
    buildId,
    observedAt: new Date().toISOString(),
    block: {
      number: block.number.toString(),
      hash: block.hash,
      finality: "finalized"
    },
    activeSupply: expected.size,
    ownersMatched: expected.size,
    metadataAvailable,
    activated: activate
  };
}
