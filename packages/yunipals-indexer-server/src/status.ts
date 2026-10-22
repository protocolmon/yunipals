import type { Pool, PoolClient } from "pg";
import type { ConfirmationPolicy } from "../../yunipals-indexer-client/src/sources.js";
import {
  evaluateSourceReadiness,
  type SourceSnapshot
} from "../../yunipals-indexer-client/src/readiness.js";
import { sqlIdentifier } from "./database.js";
import { indexerTransaction } from "./database.js";
import { readChainStatus } from "./chain-status.js";
import { readBoundRuntime, type RegisteredRelease } from "./releases.js";

export async function readIndexerSourceStatus(
  db: PoolClient,
  release: RegisteredRelease,
  sourceId: string,
  policy: ConfirmationPolicy,
  options: { nowMs?: number; maxObservationAgeMs?: number } = {}
) {
  const source = release.manifest.sources.find(
    (source) => source.id === sourceId
  );
  if (!source) throw new Error("Unknown shared indexer source.");
  const runtime = await readBoundRuntime(db, release);
  const status = await readChainStatus(db, release.id, source.chainId);
  const indexed =
    runtime.chains.find((chain) => chain.chainId === source.chainId)
      ?.completeThroughBlock ?? null;
  const observationTime = Number(status?.observed_at_ms ?? "0");
  const numbers = Object.values(status?.anchors ?? {}).map((anchor) => {
    if (
      !/^(0|[1-9][0-9]*)$/.test(anchor.number) ||
      !/^0x[0-9a-f]{64}$/.test(anchor.hash)
    )
      throw new Error("Invalid retained chain anchor.");
    return BigInt(anchor.number);
  });
  const verified = numbers.length
    ? numbers.reduce((a, b) => (a > b ? a : b))
    : null;
  let branchMatches = false;
  if (
    status?.witness_number !== null &&
    status?.witness_number !== undefined &&
    status.witness_hash
  ) {
    branchMatches =
      (
        await db.query(
          `SELECT 1 FROM ${sqlIdentifier(release.schema)}.chain_block
      WHERE chain_id=$1 AND block_number=$2::bigint AND block_hash=$3`,
          [source.chainId, status.witness_number, status.witness_hash]
        )
      ).rowCount === 1;
  }
  const observationValid =
    status !== null && status.error_code === null && branchMatches;
  const snapshot: SourceSnapshot = {
    sourceId,
    chainId: source.chainId,
    release,
    coverageStartBlock: BigInt(source.startBlock ?? "0"),
    completeThroughBlock:
      indexed === null || verified === null
        ? null
        : indexed < verified
          ? indexed
          : verified,
    indexerObservedAtMs: runtime.observedAtMs,
    halted: status?.halted === true || !runtime.running,
    head:
      observationValid && status.head_number !== null && status.head_hash
        ? {
            chainId: source.chainId,
            blockNumber: BigInt(status.head_number),
            blockHash: status.head_hash,
            observedAtMs: observationTime
          }
        : null,
    finalized:
      observationValid &&
      status.finality_error_code === null &&
      status.finalized_number !== null &&
      status.finalized_hash
        ? {
            chainId: source.chainId,
            blockNumber: BigInt(status.finalized_number),
            blockHash: status.finalized_hash,
            observedAtMs: observationTime
          }
        : null
  };
  const readiness = evaluateSourceReadiness(source, snapshot, {
    expectedRelease: release,
    policy,
    nowMs: options.nowMs ?? Date.now(),
    maxObservationAgeMs: options.maxObservationAgeMs ?? 180000
  });
  const anchor =
    readiness.availableThroughBlock === null
      ? null
      : (status?.anchors[String(readiness.availableThroughBlock)] ?? null);
  return {
    source,
    snapshot,
    readiness,
    anchor,
    observationRevision: status?.revision ?? null,
    errorCode:
      status?.error_code ??
      (!branchMatches ? "indexer_witness_unverified" : null)
  };
}

export async function indexerSourceStatus(
  pool: Pool,
  release: RegisteredRelease,
  sourceId: string,
  policy: ConfirmationPolicy,
  options: { nowMs?: number; maxObservationAgeMs?: number } = {}
) {
  return indexerTransaction(
    pool,
    (db) => readIndexerSourceStatus(db, release, sourceId, policy, options),
    true
  );
}
