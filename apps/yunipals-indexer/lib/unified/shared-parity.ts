import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  sqlIdentifier,
  indexerTransaction
} from "../../../../packages/yunipals-indexer-server/src/database.js";
import { readIndexerSourceStatus } from "../../../../packages/yunipals-indexer-server/src/status.js";
import { parseIndexedEventTopics } from "../../../../packages/yunipals-indexer-server/src/event-topics.js";
import { loadIndexerRelease, readBoundRuntime } from "./releases.js";
import { manifestDigest } from "./sources.js";
import {
  assertRetainedIndexerSources,
  validateSharedIndexerDeployment,
  type SharedIndexerDeployment
} from "./shared-deployment.js";

type CanonicalHash = (chainId: number, block: bigint) => Promise<string>;
type HistoryRow = {
  id: string;
  block_number: string;
  transaction_index: number;
  log_index: number;
  [key: string]: unknown;
};

/** Historical quiet blocks need not exist in a newly started Ponder block
 * callback. An archived comparison may use bounded canonical point checks,
 * while a conflicting physical header always fails. Nothing is backfilled. */
export async function proveSharedParityBoundary(options: {
  chainId: number;
  block: bigint;
  baselineHash?: string;
  targetHash?: string;
  archived: boolean;
  witness?: { blockNumber: bigint; blockHash: string };
  canonicalHash?: CanonicalHash;
}) {
  const { baselineHash, targetHash, witness, canonicalHash } = options;
  if (!baselineHash || !/^0x[0-9a-f]{64}$/.test(baselineHash))
    throw new Error("Parity baseline header is absent.");
  if (targetHash !== undefined) {
    if (targetHash !== baselineHash)
      throw new Error("Parity boundary belongs to a different branch.");
    return {
      hash: baselineHash,
      verification: "native" as const,
      recheck: async () => {}
    };
  }
  if (
    !options.archived ||
    !canonicalHash ||
    !witness ||
    witness.blockNumber < options.block
  )
    throw new Error(
      "Parity requires a shared native boundary or explicit archived point verification."
    );
  const recheck = async () => {
    if (
      (await canonicalHash(options.chainId, witness.blockNumber)) !==
        witness.blockHash ||
      (await canonicalHash(options.chainId, options.block)) !== baselineHash
    )
      throw new Error("Archived parity boundary or target witness changed.");
  };
  await recheck();
  return {
    hash: baselineHash,
    verification: "canonical_point_checks" as const,
    recheck
  };
}

export async function hashCanonicalHistory(
  db: Pick<PoolClient, "query">,
  schema: string,
  sourceId: string,
  throughBlock: bigint
) {
  const table = sqlIdentifier(schema);
  const digest = createHash("sha256");
  let after: HistoryRow | null = null;
  let count = 0;
  for (;;) {
    const rows: HistoryRow[] = (
      await db.query<HistoryRow>(
        `SELECT id,source_id,chain_id,address,abi_hash,name,args::jsonb AS args,
       block_number::text,block_hash,timestamp::text,transaction_hash,transaction_index,log_index,
       topics,data
       FROM ${table}.canonical_event e WHERE source_id=$1 AND e.block_number<=$2::bigint
         AND (e.block_number,e.transaction_index,e.log_index,e.id)>($3::bigint,$4::integer,$5::integer,$6::text)
       ORDER BY e.block_number,e.transaction_index,e.log_index,e.id LIMIT 2000`,
        [
          sourceId,
          String(throughBlock),
          after?.block_number ?? "-1",
          after?.transaction_index ?? -1,
          after?.log_index ?? -1,
          after?.id ?? ""
        ]
      )
    ).rows;
    for (const row of rows) {
      if (after !== null) {
        const order =
          BigInt(row.block_number) - BigInt(after.block_number) ||
          row.transaction_index - after.transaction_index ||
          row.log_index - after.log_index ||
          (row.id > after.id ? 1 : row.id === after.id ? 0 : -1);
        if (order <= 0)
          throw new Error("Canonical history pagination did not advance.");
      }
      // Ponder historical logs have four slots with trailing null padding;
      // realtime logs may contain only the actual topics. Compare the same
      // validated log evidence used by receipt verification, not its padding.
      // Interior nulls, invalid hex and excessive slots still fail closed.
      const topics = parseIndexedEventTopics(String(row.topics));
      digest.update(manifestDigest({ ...row, topics })).update("\n");
      after = row;
      count++;
    }
    if (rows.length < 2000) break;
  }
  return { events: count, sha256: digest.digest("hex") };
}

/** Compare the complete retained journal at a shared, hash-verified boundary.
 * This reads native data only; it never rewrites checkpoints or operational work. */
export async function verifySharedCanonicalHistory(
  pool: Pick<Pool, "connect">,
  baselineReleaseId: string,
  value: SharedIndexerDeployment,
  options: {
    archivedArenaBaseline?: boolean;
    canonicalHash?: CanonicalHash;
  } = {}
) {
  const deployment = validateSharedIndexerDeployment(value);
  const comparison = await indexerTransaction(
    pool,
    async (db) => {
      await db.query("SET LOCAL statement_timeout='30s'");
      const baseline = await loadIndexerRelease(db, baselineReleaseId);
      const target = await loadIndexerRelease(db, deployment.releaseId);
      if (
        target.schema !== deployment.schema ||
        target.buildId !== deployment.buildId ||
        target.manifestHash !== deployment.manifestHash
      )
        throw new Error("Parity target differs from the prepared deployment.");
      assertRetainedIndexerSources(
        baseline.manifest,
        target.manifest,
        deployment.ownershipDepthPolicies
      );
      const oldRuntime = await readBoundRuntime(db, baseline);
      const newRuntime = await readBoundRuntime(db, target);
      if (
        !newRuntime.running ||
        !newRuntime.frameworkReady ||
        (!options.archivedArenaBaseline &&
          (!oldRuntime.running || !oldRuntime.frameworkReady))
      )
        throw new Error(
          "Canonical parity requires a ready target and current serving baseline."
        );
      const sources = target.manifest.sources.filter(
        (source) =>
          source.enabled &&
          baseline.manifest.sources.some(
            (old) => old.enabled && old.id === source.id
          ) &&
          (!options.archivedArenaBaseline ||
            source.feature === "arena" ||
            source.feature === "anime-registry")
      );
      if (options.archivedArenaBaseline && sources.length !== 2)
        throw new Error(
          "Archived Arena parity requires the registry and shared Arena v2."
        );
      const chains = [...new Set(sources.map((source) => source.chainId))];
      let providerPointCalls = 0;
      const boundaries = new Map<
        number,
        {
          block: bigint;
          hash: string;
          verification: string;
          recheck: () => Promise<void>;
        }
      >();
      for (const chainId of chains) {
        const oldBlock = oldRuntime.chains.find(
          (chain) => chain.chainId === chainId
        )?.completeThroughBlock;
        const newBlock = newRuntime.chains.find(
          (chain) => chain.chainId === chainId
        )?.completeThroughBlock;
        if (
          oldBlock === null ||
          oldBlock === undefined ||
          newBlock === null ||
          newBlock === undefined
        )
          throw new Error(
            "Parity requires native coverage for every retained chain."
          );
        const block = oldBlock < newBlock ? oldBlock : newBlock;
        const hashes = await Promise.all(
          [baseline.schema, target.schema].map(
            async (schema) =>
              (
                await db.query<{ block_hash: string }>(
                  `SELECT block_hash FROM ${sqlIdentifier(schema)}.chain_block WHERE chain_id=$1 AND block_number=$2::bigint`,
                  [chainId, String(block)]
                )
              ).rows[0]?.block_hash
          )
        );
        const proof = await proveSharedParityBoundary({
          chainId,
          block,
          baselineHash: hashes[0],
          targetHash: hashes[1],
          archived: !!options.archivedArenaBaseline,
          witness: newRuntime.witnesses.find(
            (witness) => witness.chainId === chainId
          ),
          canonicalHash:
            options.canonicalHash &&
            (async (chain, number) => {
              providerPointCalls++;
              return options.canonicalHash!(chain, number);
            })
        });
        boundaries.set(chainId, { block, ...proof });
      }
      // Validate the whole snapshot before a potentially long journal walk.
      // Checking sources one by one after each hash would age this same
      // repeatable snapshot past the observation freshness window.
      for (const source of sources) {
        const status = await readIndexerSourceStatus(db, target, source.id, {
          kind: "latest"
        });
        if (!status.readiness.ready)
          throw new Error(
            `Target source unavailable: ${status.readiness.reason}.`
          );
      }
      const results = [];
      for (const source of sources) {
        const boundary = boundaries.get(source.chainId)!;
        if (
          source.startBlock === null ||
          boundary.block < BigInt(source.startBlock)
        )
          throw new Error(
            "Parity boundary precedes a retained contract deployment."
          );
        const previous = await hashCanonicalHistory(
          db,
          baseline.schema,
          source.id,
          boundary.block
        );
        const next = await hashCanonicalHistory(
          db,
          target.schema,
          source.id,
          boundary.block
        );
        if (previous.events !== next.events || previous.sha256 !== next.sha256)
          throw new Error(`Canonical history differs for ${source.id}.`);
        results.push({
          sourceId: source.id,
          chainId: source.chainId,
          throughBlock: String(boundary.block),
          blockHash: boundary.hash,
          boundaryVerification: boundary.verification,
          ...next
        });
      }
      for (const boundary of boundaries.values()) await boundary.recheck();
      return {
        format: "yunipals-shared-canonical-parity-v1",
        baselineReleaseId,
        targetReleaseId: target.id,
        archivedArenaBaseline: !!options.archivedArenaBaseline,
        sources: results,
        matched: true,
        writes: 0,
        providerPointCalls
      };
    },
    true
  );
  // A held snapshot cannot see a reorg or stopped worker that occurred during
  // hashing. Recheck current readiness and the exact compared boundaries after
  // ending that transaction; do not accept its old view as present health.
  await indexerTransaction(
    pool,
    async (db) => {
      const target = await loadIndexerRelease(db, deployment.releaseId);
      const baseline = await loadIndexerRelease(db, baselineReleaseId);
      const current = await readBoundRuntime(db, target);
      const previous = await readBoundRuntime(db, baseline);
      if (
        !current.running ||
        !current.frameworkReady ||
        (!options.archivedArenaBaseline &&
          (!previous.running || !previous.frameworkReady))
      )
        throw new Error(
          "Source stopped or became unavailable during parity comparison."
        );
      for (const source of comparison.sources) {
        const status = await readIndexerSourceStatus(
          db,
          target,
          source.sourceId,
          { kind: "latest" }
        );
        if (
          !status.readiness.ready ||
          !current.chains.some(
            (chain) =>
              chain.chainId === source.chainId &&
              chain.completeThroughBlock !== null &&
              chain.completeThroughBlock >= BigInt(source.throughBlock)
          )
        )
          throw new Error(
            "Source readiness or coverage changed during parity comparison."
          );
        for (const schema of [
          baseline.schema,
          ...(source.boundaryVerification === "native" ? [target.schema] : [])
        ]) {
          const hash = (
            await db.query<{ block_hash: string }>(
              `SELECT block_hash FROM ${sqlIdentifier(schema)}.chain_block WHERE chain_id=$1 AND block_number=$2::bigint`,
              [source.chainId, source.throughBlock]
            )
          ).rows[0]?.block_hash;
          if (hash !== source.blockHash)
            throw new Error(
              "Compared native boundary changed or expired during parity comparison."
            );
        }
      }
    },
    true
  );
  return { ...comparison, currentReadinessRechecked: true };
}
