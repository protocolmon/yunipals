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
): Promise<
  "observed" | "waiting" | "waiting_retained" | "superseded" | "halted"
> {
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
  const commitProviderLag = async () => {
    const previous = read.previous;
    const maximumAge = Math.min(options.maxHeadAgeMs ?? 180000, 180000);
    const unsigned = (value: unknown): value is string =>
      typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
    const hash = (value: unknown): value is string =>
      typeof value === "string" &&
      /^0x[0-9a-f]{64}$/.test(value) &&
      !/^0x0{64}$/.test(value);
    const fresh = () =>
      previous !== null &&
      unsigned(previous.observed_at_ms) &&
      BigInt(previous.observed_at_ms) <= BigInt(now()) &&
      BigInt(now()) - BigInt(previous.observed_at_ms) <= BigInt(maximumAge) &&
      unsigned(previous.head_timestamp) &&
      BigInt(previous.head_timestamp) * 1000n <= BigInt(now() + 30000) &&
      BigInt(now()) - BigInt(previous.head_timestamp) * 1000n <=
        BigInt(maximumAge);
    const anchors = Object.entries(previous?.anchors ?? {});
    const maximumAnchors =
      1 +
      release.manifest.sources
        .filter((source) => source.enabled && source.chainId === chainId)
        .reduce((count, source) => count + source.policies.length, 0);
    if (
      previous &&
      !previous.halted &&
      (previous.error_code === null ||
        previous.error_code === "provider_lag") &&
      fresh() &&
      unsigned(previous.head_number) &&
      hash(previous.head_hash) &&
      unsigned(previous.witness_number) &&
      hash(previous.witness_hash) &&
      BigInt(previous.witness_number) <= BigInt(previous.head_number) &&
      anchors.length > 0 &&
      anchors.length <= maximumAnchors &&
      anchors.every(
        ([key, value]) =>
          unsigned(key) &&
          value !== null &&
          value.number === key &&
          hash(value.hash) &&
          unsigned(value.timestamp) &&
          BigInt(key) <= BigInt(previous.witness_number!) &&
          BigInt(value.timestamp) <= BigInt(previous.head_timestamp!)
      )
    ) {
      const retained = await indexerTransaction(pool, async (db) => {
        const current = await readBoundRuntime(db, release);
        const coverage = current.chains.find(
          (chain) => chain.chainId === chainId
        )?.completeThroughBlock;
        if (
          !current.running ||
          !current.frameworkReady ||
          now() - current.observedAtMs > 180000 ||
          current.observedAtMs > now() ||
          coverage === null ||
          coverage === undefined ||
          anchors.some(([height]) => BigInt(height) > coverage) ||
          !fresh()
        )
          return false;
        // Native block history can be sparse. The native witness authenticates
        // the branch; the unchanged RPC anchors retain their original witness
        // association, rather than pretending each has a native block row.
        const proof = await db.query(
          `SELECT 1 WHERE EXISTS (SELECT 1 FROM ${sqlIdentifier(release.schema)}.chain_block
             WHERE chain_id=$1 AND block_number=$2::bigint AND block_hash=$3)
           AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset($4::jsonb) AS a(number text,hash text)
             WHERE NOT EXISTS (SELECT 1 FROM yunipals_indexer_control.chain_anchor c
               WHERE c.release_id=$5 AND c.chain_id=$1 AND c.block_number=a.number::bigint
                 AND c.block_hash=a.hash AND c.witness_number=$2::bigint AND c.witness_hash=$3))`,
          [
            chainId,
            previous.witness_number,
            previous.witness_hash,
            JSON.stringify(anchors.map(([, value]) => value)),
            release.id
          ]
        );
        if (proof.rowCount !== 1 || !fresh()) return false;
        const result = await db.query(
          `UPDATE yunipals_indexer_control.chain_status SET revision=revision+1,
             error_code=NULL,checked_at=clock_timestamp()
           WHERE release_id=$1 AND chain_id=$2 AND revision=$3::bigint AND NOT halted
             AND (error_code IS NULL OR error_code='provider_lag')
             AND observed_at_ms=$4::bigint AND witness_number=$5::bigint AND witness_hash=$6
             AND anchors=$7::jsonb`,
          [
            release.id,
            chainId,
            revision,
            previous.observed_at_ms,
            previous.witness_number,
            previous.witness_hash,
            JSON.stringify(previous.anchors)
          ]
        );
        return result.rowCount === 1
          ? ("waiting_retained" as const)
          : ("superseded" as const);
      });
      if (retained !== false) return retained;
    }
    // A lag cycle must not overwrite another unresolved error and then clear
    // it on the next lag cycle. Only a new full observation can recover it.
    return commitError(
      previous?.error_code && previous.error_code !== "provider_lag"
        ? previous.error_code
        : "provider_lag"
    );
  };
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
      return commitProviderLag();
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
          return commitProviderLag();
      }
      cache.set(finalized.number, finalized);
    }
    if (indexed > head.number || witness.blockNumber > head.number)
      return commitProviderLag();
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
