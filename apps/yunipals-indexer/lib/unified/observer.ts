import type { Pool } from "pg";
import { indexerTransaction } from "./control-schema.js";
import { readBoundRuntime, type RegisteredRelease } from "./releases.js";
import type { EvidenceBlock, EvidenceRpc } from "./rpc.js";
import { sqlIdentifier } from "../../../../packages/yunipals-indexer-server/src/database.js";

import {
  readChainStatus,
  type StoredAnchor
} from "../../../../packages/yunipals-indexer-server/src/chain-status.js";
export {
  readChainStatus,
  type ChainStatusRow,
  type StoredAnchor
} from "../../../../packages/yunipals-indexer-server/src/chain-status.js";

function validBlock(block: EvidenceBlock, number?: bigint) {
  if (
    block.number < 0n ||
    block.timestamp < 0n ||
    (number !== undefined && block.number !== number) ||
    !/^0x[0-9a-f]{64}$/.test(block.hash) ||
    /^0x0{64}$/.test(block.hash) ||
    !/^0x[0-9a-f]{64}$/.test(block.parentHash)
  )
    throw new Error("invalid_block");
  return block;
}
const anchor = (block: EvidenceBlock): StoredAnchor => ({
  number: String(block.number),
  hash: block.hash,
  timestamp: String(block.timestamp)
});

export async function observeIndexerChain(
  pool: Pool,
  release: RegisteredRelease,
  chainId: number,
  rpc: EvidenceRpc,
  options: { now?: () => number; maxHeadAgeMs?: number } = {}
): Promise<"observed" | "waiting" | "superseded" | "halted"> {
  const now = options.now ?? Date.now;
  if (
    !Number.isSafeInteger(now()) ||
    !Number.isSafeInteger(options.maxHeadAgeMs ?? 180000) ||
    (options.maxHeadAgeMs ?? 180000) <= 0
  ) {
    throw new Error("Invalid chain observation clock or freshness limit.");
  }
  const read = await indexerTransaction(
    pool,
    async (db) => ({
      runtime: await readBoundRuntime(db, release),
      previous: await readChainStatus(db, release.id, chainId)
    }),
    true
  );
  const revision = read.previous?.revision ?? "0";
  if (read.previous?.halted) return "halted";
  const chain = read.runtime.chains.find((chain) => chain.chainId === chainId);
  const witness = read.runtime.witnesses.find(
    (witness) => witness.chainId === chainId
  );
  const commitError = async (code: string, halt = false) => {
    const result = await pool.query(
      `INSERT INTO yunipals_indexer_control.chain_status(release_id,chain_id,revision,halted,error_code)
      VALUES($1,$2,1,$4,$5) ON CONFLICT(release_id,chain_id) DO UPDATE
      SET revision=chain_status.revision+1,halted=chain_status.halted OR $4,error_code=$5,checked_at=clock_timestamp()
      WHERE chain_status.revision=$3::bigint`,
      [release.id, chainId, revision, halt, code]
    );
    return result.rowCount !== 1
      ? ("superseded" as const)
      : halt
        ? ("halted" as const)
        : ("waiting" as const);
  };
  if (
    !chain ||
    chain.completeThroughBlock === null ||
    !witness ||
    !read.runtime.running ||
    now() - read.runtime.observedAtMs > 180000 ||
    read.runtime.observedAtMs > now()
  )
    return commitError("indexer_not_ready");
  const indexed =
    chain.completeThroughBlock < witness.blockNumber
      ? chain.completeThroughBlock
      : witness.blockNumber;
  try {
    if ((await rpc.chainId()) !== chainId)
      return commitError("rpc_chain_mismatch");
    // Read finalized first: a fast chain may otherwise finalize N+1 between reads.
    let finalized: EvidenceBlock | null = null;
    let finalityError: string | null = null;
    try {
      finalized = validBlock(await rpc.block("finalized"));
    } catch {
      finalityError = "finality_unavailable";
    }
    const head = validBlock(await rpc.block("latest"));
    const cache = new Map<bigint, EvidenceBlock>([[head.number, head]]);
    const blockAt = async (number: bigint) => {
      const cached = cache.get(number);
      if (cached) return cached;
      const block = validBlock(await rpc.block(number), number);
      cache.set(number, block);
      return block;
    };
    const freshHead = () =>
      head.timestamp * 1000n <= BigInt(now() + 30000) &&
      BigInt(now()) - head.timestamp * 1000n <=
        BigInt(options.maxHeadAgeMs ?? 180000);
    if (!freshHead()) return commitError("head_stale");
    if (
      read.previous?.head_number !== null &&
      read.previous?.head_number !== undefined &&
      head.number < BigInt(read.previous.head_number)
    )
      return commitError("provider_lag");
    if (
      read.previous?.finalized_number !== null &&
      read.previous?.finalized_number !== undefined &&
      (await blockAt(BigInt(read.previous.finalized_number))).hash !==
        read.previous.finalized_hash
    ) {
      return commitError("finalized_history_changed", true);
    }
    if (finalized) {
      if (
        finalized.number > head.number ||
        finalized.timestamp > head.timestamp ||
        (finalized.number === head.number && finalized.hash !== head.hash)
      )
        return commitError("provider_inconsistent");
      if (
        read.previous?.finalized_number !== null &&
        read.previous?.finalized_number !== undefined
      ) {
        if (finalized.number < BigInt(read.previous.finalized_number))
          return commitError("provider_lag");
      }
      cache.set(finalized.number, finalized);
    }
    if (indexed > head.number || witness.blockNumber > head.number)
      return commitError("provider_lag");
    if ((await blockAt(witness.blockNumber)).hash !== witness.blockHash)
      return commitError("indexer_branch_mismatch");
    const heights = new Set<bigint>([indexed]);
    for (const source of release.manifest.sources.filter(
      (source) => source.enabled && source.chainId === chainId
    )) {
      for (const policy of source.policies) {
        const boundary =
          policy.kind === "latest"
            ? head.number
            : policy.kind === "depth"
              ? head.number - BigInt(policy.subsequentBlocks)
              : finalized?.number;
        if (boundary === undefined || boundary < 0n) continue;
        let through = boundary < indexed ? boundary : indexed;
        if (source.endBlock !== null && through > BigInt(source.endBlock))
          through = BigInt(source.endBlock);
        if (source.startBlock !== null && through >= BigInt(source.startBlock))
          heights.add(through);
      }
    }
    const anchors: Record<string, StoredAnchor> = {};
    for (const height of [...heights].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0
    ))
      anchors[String(height)] = anchor(await blockAt(height));
    // Detect a branch change during the bounded reads without waiting for a new head.
    if (
      validBlock(await rpc.block(head.number), head.number).hash !==
        head.hash ||
      !freshHead()
    )
      return commitError("observation_changed");
    const observedAt = now();
    return indexerTransaction(pool, async (db) => {
      const current = await readBoundRuntime(db, release);
      const proof = await db.query(
        `SELECT 1 FROM ${sqlIdentifier(release.schema)}.chain_block
        WHERE chain_id=$1 AND block_number=$2::bigint AND block_hash=$3`,
        [chainId, String(witness.blockNumber), witness.blockHash]
      );
      const coverage = current.chains.find(
        (chain) => chain.chainId === chainId
      )?.completeThroughBlock;
      if (
        !current.running ||
        coverage === undefined ||
        coverage === null ||
        coverage < indexed ||
        proof.rowCount !== 1
      )
        return "superseded";
      const result = await db.query(
        `INSERT INTO yunipals_indexer_control.chain_status
        (release_id,chain_id,revision,head_number,head_hash,head_timestamp,finalized_number,finalized_hash,
         witness_number,witness_hash,observed_at_ms,provider_id,anchors,error_code,finality_error_code)
        VALUES($1,$2,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,$14)
        ON CONFLICT(release_id,chain_id) DO UPDATE SET revision=chain_status.revision+1,
          head_number=$4,head_hash=$5,head_timestamp=$6,
          finalized_number=COALESCE($7,chain_status.finalized_number),finalized_hash=COALESCE($8,chain_status.finalized_hash),
          witness_number=$9,witness_hash=$10,observed_at_ms=$11,provider_id=$12,anchors=$13,
          error_code=NULL,finality_error_code=$14,checked_at=clock_timestamp()
        WHERE chain_status.revision=$3::bigint AND NOT chain_status.halted`,
        [
          release.id,
          chainId,
          revision,
          String(head.number),
          head.hash,
          String(head.timestamp),
          finalized?.number.toString() ?? null,
          finalized?.hash ?? null,
          String(witness.blockNumber),
          witness.blockHash,
          observedAt,
          rpc.providerId,
          JSON.stringify(anchors),
          finalityError
        ]
      );
      if (result.rowCount !== 1) return "superseded";
      for (const value of Object.values(anchors)) {
        await db.query(
          `INSERT INTO yunipals_indexer_control.chain_anchor
          (release_id,chain_id,block_number,block_hash,witness_number,witness_hash) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(release_id,chain_id,block_number) DO UPDATE
          SET block_hash=$4,witness_number=$5,witness_hash=$6`,
          [
            release.id,
            chainId,
            value.number,
            value.hash,
            String(witness.blockNumber),
            witness.blockHash
          ]
        );
      }
      await db.query(
        `DELETE FROM yunipals_indexer_control.chain_anchor WHERE release_id=$1 AND chain_id=$2
        AND witness_number<$3::bigint`,
        [release.id, chainId, String(witness.blockNumber - 4096n)]
      );
      return "observed";
    });
  } catch {
    return commitError("rpc_unavailable");
  }
}
