import { isDeepStrictEqual } from "node:util";
import type { Pool } from "pg";
import type { Hex, PublicClient } from "viem";
import type { MarketOrder } from "@protopals/yunipals-market-core/marketOrder";
import {
  isOpenSeaChain,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import {
  address,
  decimal,
  hex
} from "@protopals/yunipals-market-core/validation";

import { completeJob, enqueueJob, type Job } from "@/db/jobs";
import {
  indexedTransferBatchSize,
  readIndexedTransfers
} from "@/db/indexedTransfers";
import { transaction } from "@/db/pool";
import {
  assertOpenSeaObservationCurrent,
  inspectOpenSeaAdmission,
  readOpenSeaProtocolState,
  type OpenSeaObservation,
  type OpenSeaObservationOptions
} from "@/opensea/chain";
import { readIndexedOpenSeaAsset } from "@/opensea/indexer";
import {
  checkOpenSeaOrder,
  OpenSeaOrderError,
  parseOpenSeaOrderRequest
} from "@/opensea/orders";
import {
  openSeaProjectionAuditDelayMs,
  openSeaTransientRetryDelayMs
} from "@/opensea/discoveredReconciliation";
import { readRetainedOpenSeaCandidate } from "@/opensea/outbox";
import type { OpenSeaPolicyResolver } from "@/opensea/policy";
import { retainedStreamWakeSql } from "@/opensea/streamWake";

const protocol = seaportDeployment.address.toLowerCase();
export const openSeaReconcileKind = "opensea_order_reconcile";
type Retained = NonNullable<
  Awaited<ReturnType<typeof readRetainedOpenSeaCandidate>>
>;
type Policies = Pick<OpenSeaPolicyResolver, "resolve">;
type Observation = {
  state: MarketOrder["status"];
  reason: string | null;
  observed: OpenSeaObservation | null;
  transferHash: Hex | null;
};
type ReconcileScheduleCandidate = {
  order_hash: Hex;
  generation: string;
  job_state: string | null;
  stream_sequence: string;
};
type IndexedRetainedCandidate = ReconcileScheduleCandidate & {
  token_id: string;
  bound_transfer_hash: string;
};

export async function observeOpenSeaOrder(
  pool: Pool,
  client: PublicClient,
  retained: Retained,
  policies: Policies,
  options: OpenSeaObservationOptions
): Promise<Observation> {
  if (retained.state !== "accepted")
    throw new OpenSeaOrderError("order_not_accepted");
  const publication = retained.publication;
  const input = {
    ...parseOpenSeaOrderRequest({
      asset: publication.summary.asset,
      lifecycle: publication.summary.lifecycle,
      order: publication.order,
      policyVersion: retained.policyVersion
    }),
    signature: publication.signature
  };
  // Resolve before the short chain window. A provider failure cannot suppress
  // an independently observed fill, cancellation, counter change or expiry.
  const policy = await policies.resolve(input.asset.chain).catch(() => null);
  const state = await readOpenSeaProtocolState(
    client,
    input,
    options.now,
    undefined,
    undefined,
    options.finality
  );
  let status: MarketOrder["status"];
  let reason: string | null = null;
  let transferHash: Hex | null = null;
  if (state.size > 0n && state.filled >= state.size) status = "filled";
  else if (state.cancelled) status = "cancelled";
  else if (state.counter !== input.order.counter) status = "counter-changed";
  else if (input.order.endTime <= state.observed.timestamp) status = "expired";
  else {
    try {
      if (!policy)
        throw new OpenSeaOrderError("provider_policy_unavailable", 503);
      const timestamp = () =>
        BigInt(
          Math.max(
            Math.floor((options.now?.() ?? Date.now()) / 1000),
            Number(state.observed.timestamp)
          )
        );
      checkOpenSeaOrder(input, policy.policy, timestamp(), "catalog");
      const indexed = await readIndexedOpenSeaAsset(pool, input.asset);
      transferHash = indexed.lastTransfer.transactionHash;
      await inspectOpenSeaAdmission(
        client,
        input,
        indexed,
        options,
        state.observed,
        state
      );
      const current = await readIndexedOpenSeaAsset(pool, input.asset);
      transferHash = current.lastTransfer.transactionHash;
      const { checkpoint: before, ...previousAsset } = indexed;
      const { checkpoint: after, ...currentAsset } = current;
      if (
        !isDeepStrictEqual(previousAsset, currentAsset) ||
        after.number < before.number ||
        after.heartbeatAt < before.heartbeatAt
      )
        throw new OpenSeaOrderError("asset_still_syncing", 503);
      checkOpenSeaOrder(input, policy.policy, timestamp(), "catalog");
      status = "active";
    } catch (error) {
      status = "unavailable";
      reason =
        error instanceof OpenSeaOrderError
          ? error.code
          : "chain_or_indexer_unavailable";
    }
  }
  await assertOpenSeaObservationCurrent(client, state.observed, options.now);
  return { state: status, reason, observed: state.observed, transferHash };
}

function key(chainId: number, hash: string, generation: string) {
  return `${chainId}:${hash}:${generation}`;
}

// Scope each worker to its configured chain. Lock orders first without touching
// active jobs; processors lock jobs first, so this avoids a reverse lock cycle.
export async function scheduleOpenSeaReconciliation(
  pool: Pool,
  chain: OpenSeaChain,
  limit = 100,
  orderHash?: Hex
) {
  if (
    !isOpenSeaChain(chain) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new Error("Invalid OpenSea reconciliation scope.");
  const chainId = marketplaceChains[chain].chainId;
  const scope = orderHash ? hex(orderHash, 32) : null;
  return transaction(pool, async (db) => {
    const due = await db.query<ReconcileScheduleCandidate>(
      `SELECT o.order_hash,o.reconcile_generation::text AS generation,j.state AS job_state,
        ${retainedStreamWakeSql.version}::text AS stream_sequence
      FROM yunipals_market.orders o LEFT JOIN yunipals_market.job j
        ON j.kind='opensea_order_reconcile' AND j.deduplication_key=
          o.chain_id::text||':'||o.order_hash||':'||o.reconcile_generation::text
      ${retainedStreamWakeSql.joins}
      WHERE o.chain_id=$1 AND o.protocol_address=$2 AND o.source='opensea' AND o.publication_state='accepted'
        AND o.terminal_at IS NULL
        AND (o.next_reconcile_at<=clock_timestamp() OR (
          ${retainedStreamWakeSql.version}>o.stream_ack_seq AND coalesce(j.state,'') NOT IN ('pending','running')
        )) AND ($3::text IS NULL OR o.order_hash=$3)
      ORDER BY least(o.next_reconcile_at,
        coalesce(${retainedStreamWakeSql.requestedAt},o.next_reconcile_at)),o.order_hash
      LIMIT ${limit} FOR UPDATE OF o SKIP LOCKED`,
      [chainId, protocol, scope]
    );
    const rows = [...due.rows];
    const remaining = Math.min(limit - rows.length, indexedTransferBatchSize);
    if (remaining > 0) {
      const checked = await db.query<IndexedRetainedCandidate>(
        `SELECT o.order_hash,o.reconcile_generation::text AS generation,
          j.state AS job_state,o.token_id::text AS token_id,
          o.bound_transfer_hash,${retainedStreamWakeSql.version}::text AS stream_sequence
        FROM yunipals_market.orders o LEFT JOIN yunipals_market.job j
          ON j.kind='opensea_order_reconcile' AND j.deduplication_key=
            o.chain_id::text||':'||o.order_hash||':'||o.reconcile_generation::text
        ${retainedStreamWakeSql.joins}
        WHERE o.chain_id=$1 AND o.protocol_address=$2 AND o.source='opensea'
          AND o.publication_state='accepted' AND o.bound_transfer_hash IS NOT NULL
          AND o.terminal_at IS NULL
          AND o.token_id IS NOT NULL AND ($3::text IS NULL OR o.order_hash=$3)
          AND NOT (o.order_hash=ANY($4::text[]))
          AND ($3::text IS NOT NULL OR
            o.indexed_transfer_checked_at<=clock_timestamp()-interval '1 minute')
        ORDER BY o.indexed_transfer_checked_at,o.order_hash
        LIMIT ${remaining} FOR UPDATE OF o SKIP LOCKED`,
        [chainId, protocol, scope, due.rows.map((row) => row.order_hash)]
      );
      if (checked.rows.length > 0) {
        const indexed = await readIndexedTransfers(
          db,
          chain,
          checked.rows.map((row) => row.token_id)
        );
        await db.query(
          `UPDATE yunipals_market.orders SET indexed_transfer_checked_at=clock_timestamp()
          WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=ANY($3::text[])`,
          [chainId, protocol, checked.rows.map((row) => row.order_hash)]
        );
        rows.push(
          ...checked.rows.filter((row) => {
            const token = indexed.get(row.token_id);
            return (
              token !== undefined &&
              token.transactionHash !== row.bound_transfer_hash
            );
          })
        );
      }
    }
    for (const row of rows) {
      const retired =
        row.job_state === "failed" || row.job_state === "completed";
      const generation = (
        BigInt(row.generation) + (retired ? 1n : 0n)
      ).toString();
      if (!row.job_state || retired)
        await enqueueJob(db, {
          kind: openSeaReconcileKind,
          key: key(chainId, row.order_hash, generation),
          payload: {
            chainId,
            protocolAddress: protocol,
            orderHash: row.order_hash,
            generation,
            streamSequence: row.stream_sequence
          }
        });
      await db.query(
        `UPDATE yunipals_market.orders SET reconcile_generation=$4,
        next_reconcile_at=clock_timestamp()+interval '60 seconds',
        state=CASE WHEN $5 THEN 'unavailable' ELSE state END,
        state_reason=CASE WHEN $5 THEN 'reconciliation_job_retired' ELSE state_reason END,
        state_observed_at=CASE WHEN $5 THEN NULL ELSE state_observed_at END
        WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3`,
        [chainId, protocol, row.order_hash, generation, retired]
      );
    }
    return rows.length;
  });
}

export async function reconcileOpenSeaJob(
  pool: Pool,
  client: PublicClient,
  chain: OpenSeaChain,
  policies: Policies,
  options: OpenSeaObservationOptions,
  job: Job
) {
  if (
    !isOpenSeaChain(chain) ||
    job.kind !== openSeaReconcileKind ||
    job.payload.chainId !== marketplaceChains[chain].chainId ||
    address(job.payload.protocolAddress).toLowerCase() !== protocol
  )
    throw new Error("Invalid OpenSea reconciliation job.");
  const chainId = marketplaceChains[chain].chainId;
  const hash = hex(job.payload.orderHash, 32);
  const generation = decimal(job.payload.generation);
  const streamSequence = decimal(job.payload.streamSequence ?? "0");
  if (
    BigInt(generation) > 9223372036854775807n ||
    BigInt(streamSequence) > 9223372036854775807n
  )
    throw new Error("Invalid OpenSea reconciliation generation.");
  const retained = await readRetainedOpenSeaCandidate(pool, chainId, hash);
  if (
    !retained ||
    retained.state !== "accepted" ||
    retained.generation !== generation
  ) {
    await completeJob(pool, job, async () => false);
    return;
  }
  let observation: Observation;
  try {
    observation = await observeOpenSeaOrder(
      pool,
      client,
      retained,
      policies,
      options
    );
  } catch (error) {
    observation = {
      state: "unavailable",
      observed: null,
      transferHash: null,
      reason:
        error instanceof OpenSeaOrderError ? error.code : "chain_unavailable"
    };
  }
  return completeJob(pool, job, async (db) => {
    const age = observation.observed
      ? (options.now?.() ?? Date.now()) - observation.observed.checkedAt
      : 0;
    if (observation.observed && (age < 0 || age > 10000))
      observation = {
        state: "unavailable",
        reason: "observation_expired",
        observed: null,
        transferHash: observation.transferHash
      };
    const failed =
      !observation.observed ||
      ["chain_or_indexer_unavailable", "provider_policy_unavailable"].includes(
        observation.reason ?? ""
      );
    const failures = failed ? Math.min(retained.failures + 1, 16) : 0;
    const delayMs = failed
      ? openSeaTransientRetryDelayMs(hash, failures)
      : openSeaProjectionAuditDelayMs(hash);
    const observed = observation.observed;
    const result = await db.query(
      `UPDATE yunipals_market.orders SET state=$5,state_reason=$6,state_observed_at=$7,
      state_block_number=$8,state_block_hash=$9,updated_at=clock_timestamp(),reconcile_generation=reconcile_generation+1,
      reconcile_failures=$10,bound_transfer_hash=coalesce($11,bound_transfer_hash),
      next_reconcile_at=CASE WHEN $5='expired' THEN 'infinity'::timestamptz
        ELSE clock_timestamp()+$12*interval '1 millisecond' END,
      terminal_at=CASE WHEN $5='expired' THEN coalesce(terminal_at,clock_timestamp()) ELSE terminal_at END,
      terminal_reason=CASE WHEN $5='expired' THEN 'expired' ELSE terminal_reason END,
      stream_ack_seq=greatest(stream_ack_seq,$13::bigint)
      WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3 AND reconcile_generation=$4
        AND source='opensea' AND publication_state='accepted'`,
      [
        chainId,
        protocol,
        hash,
        generation,
        observation.state,
        observation.reason,
        observed ? new Date(observed.checkedAt) : null,
        observed?.number.toString() ?? null,
        observed?.hash.toLowerCase() ?? null,
        failures,
        observation.transferHash?.toLowerCase() ?? null,
        delayMs,
        streamSequence
      ]
    );
    return result.rowCount === 1;
  });
}

export async function pruneOpenSeaReconcileJobs(pool: Pool, limit = 100) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("Invalid cleanup batch size.");
  const result = await pool.query(`DELETE FROM yunipals_market.job WHERE id IN (
    SELECT j.id FROM yunipals_market.job j JOIN yunipals_market.orders o
      ON o.chain_id::text=j.payload->>'chainId' AND o.protocol_address=lower(j.payload->>'protocolAddress')
        AND o.order_hash=lower(j.payload->>'orderHash') AND o.source='opensea'
    WHERE j.kind='opensea_order_reconcile' AND j.state='completed' AND j.updated_at<clock_timestamp()-interval '1 day'
      AND j.deduplication_key<>o.chain_id::text||':'||o.order_hash||':'||o.reconcile_generation::text
    ORDER BY j.updated_at LIMIT ${limit} FOR UPDATE OF j SKIP LOCKED)`);
  return result.rowCount ?? 0;
}
