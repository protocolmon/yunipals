import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  baseIslandsAbi,
  retryBaseRead,
  type BaseReadClient
} from "./base-rpc.js";
import {
  baseIslandCollection as collection,
  baseIslandRuntimeSha256,
  airdropSnapshotSha256,
  airdropDistributionSha256,
  legacyBaseIslandCollection,
  baseIslandMetadataUri,
  replacementSnapshotSha256,
  replacementSnapshotBlock,
  replacementSnapshotBlockHash,
  replacementDistributionRoot,
  revealAssignmentsSha256
} from "./collections.js";

const schema = collection.schemaName;
export type BaseBlock = { number: bigint; hash: string };

export async function verifyBaseContract(
  client: BaseReadClient,
  block: BaseBlock
) {
  if ((await retryBaseRead(() => client.getChainId())) !== 8453)
    throw new Error("base_islands_rpc_chain_mismatch");
  const code = await retryBaseRead(() =>
    client.getCode({
      address: collection.address,
      blockNumber: block.number
    })
  );
  if (
    !code ||
    createHash("sha256")
      .update(Buffer.from(code.slice(2), "hex"))
      .digest("hex") !== baseIslandRuntimeSha256
  )
    throw new Error("base_islands_runtime_mismatch");
  const values = await retryBaseRead(() =>
    client.multicall({
      blockNumber: block.number,
      allowFailure: false,
      contracts: (
        [
          "SOURCE_CONTRACT",
          "SNAPSHOT_JSON_SHA256",
          "DISTRIBUTION_CSV_SHA256",
          "REPLACES_CONTRACT",
          "BASE_METADATA_URI",
          "DISTRIBUTION_ROOT",
          "REPLACEMENT_SNAPSHOT_BLOCK",
          "REPLACEMENT_SNAPSHOT_HASH",
          "REPLACEMENT_SNAPSHOT_SHA256",
          "REVEAL_ASSIGNMENTS_SHA256"
        ] as const
      ).map((functionName) => ({
        address: collection.address,
        abi: baseIslandsAbi,
        functionName
      }))
    })
  );
  if (
    String(values[0]).toLowerCase() !==
      "0xa22e2f53ca787414dc0643c399f92234949e2305" ||
    values[1] !== `0x${airdropSnapshotSha256}` ||
    values[2] !== `0x${airdropDistributionSha256}` ||
    String(values[3]).toLowerCase() !== legacyBaseIslandCollection.address ||
    values[4] !== baseIslandMetadataUri ||
    values[5] !== replacementDistributionRoot ||
    values[6] !== replacementSnapshotBlock ||
    values[7] !== replacementSnapshotBlockHash ||
    values[8] !== `0x${replacementSnapshotSha256}` ||
    values[9] !== `0x${revealAssignmentsSha256}`
  )
    throw new Error("base_islands_provenance_constants_mismatch");
}

/** Compare the entire indexed owner set at one finalized block, not today's snapshot recipients. */
export async function verifyBaseOwnership(
  pool: Pick<Pool, "query">,
  client: BaseReadClient,
  block: BaseBlock
) {
  const state = await pool.query<{
    last_scanned_block: string;
  }>(`SELECT last_scanned_block::text
    FROM ${schema}.sync_state WHERE singleton`);
  if (
    !state.rows[0]?.last_scanned_block ||
    BigInt(state.rows[0].last_scanned_block) < block.number
  )
    throw new Error("base_islands_verification_backfill_pending");
  const indexed = await pool.query<{ tokenId: string; owner: string }>(
    `SELECT token_id AS "tokenId","to" AS owner FROM (
    SELECT DISTINCT ON(token_id) token_id,"to" FROM ${schema}.transfer_event WHERE block_number<=$1
    ORDER BY token_id,block_number DESC,transaction_index DESC,log_index DESC
  ) owners WHERE "to"<>'0x0000000000000000000000000000000000000000' ORDER BY token_id::numeric`,
    [String(block.number)]
  );
  const supply = await retryBaseRead(() =>
    client.readContract({
      address: collection.address,
      abi: baseIslandsAbi,
      functionName: "totalSupply",
      blockNumber: block.number
    })
  );
  if (supply !== BigInt(indexed.rows.length))
    throw new Error("base_islands_supply_mismatch");
  const origins = await pool.query<{ verified: number }>(
    `SELECT count(*)::int AS verified
    FROM metadata.island_replacement_origin o JOIN ${schema}.transfer_event mint ON mint.token_id=o.token_id
    AND mint."from"='0x0000000000000000000000000000000000000000' AND mint."to"=o.recipient
    AND mint.block_number<=$1 WHERE o.snapshot_sha256=$2`,
    [String(block.number), replacementSnapshotSha256]
  );
  if (origins.rows[0]?.verified !== 898)
    throw new Error("base_islands_airdrop_mint_mismatch");
  for (let offset = 0; offset < indexed.rows.length; offset += 50) {
    const batch = indexed.rows.slice(offset, offset + 50);
    const owners = await retryBaseRead(() =>
      client.multicall({
        allowFailure: false,
        blockNumber: block.number,
        batchSize: 16_000,
        contracts: batch.map(
          (token) =>
            ({
              address: collection.address,
              abi: baseIslandsAbi,
              functionName: "ownerOf",
              args: [BigInt(token.tokenId)]
            }) as const
        )
      })
    );
    if (
      owners.some((owner, index) => owner.toLowerCase() !== batch[index]!.owner)
    )
      throw new Error("base_islands_current_ownership_mismatch");
  }
  const latest = await retryBaseRead(() =>
    client.getBlock({
      blockNumber: block.number,
      includeTransactions: false
    })
  );
  if (latest.hash !== block.hash)
    throw new Error("base_islands_finalized_block_changed");
  await pool.query(
    `UPDATE ${schema}.sync_state SET verified_block=$1,verified_hash=$2,verified_at=now()
    WHERE singleton AND last_scanned_block>=$1`,
    [String(block.number), block.hash]
  );
  return {
    block: String(block.number),
    blockHash: block.hash,
    ownersVerified: indexed.rows.length,
    airdropMintsVerified: origins.rows[0].verified,
    unexpectedTokenCount: indexed.rows.length - 898
  };
}
