import type { Pool } from "pg";
import type { Hex, PublicClient } from "viem";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";

import { inspectBnbAdmission } from "@/bnb/chain";
import { readIndexedBnbAsset } from "@/bnb/indexer";
import {
  BnbOrderError,
  checkBnbOrder,
  type BnbPolicy,
  type OrderStatus
} from "@/bnb/orders";
import {
  assertBnbObservationCurrent,
  bnbObservationMaxAgeMs,
  readBnbProtocolState,
  type BnbObservation
} from "@/bnb/protocol";
import { bnbOrderIdentity } from "@/bnb/recovery";
import { loadAcceptedBnbOrder } from "@/bnb/storedOrder";
import { completeJob, enqueueJob, type Job } from "@/db/jobs";
import {
  indexedTransferBatchSize,
  readIndexedTransfers
} from "@/db/indexedTransfers";
import { transaction } from "@/db/pool";
import { rpcComputeBudgetError } from "@/opensea/rpcComputeBudget";

const protocol = seaportDeployment.address.toLowerCase();
export const bnbReconcileKind = "bnb_order_reconcile";
type Options = {
  confirmations: bigint;
  indexerMaxAgeMs: number;
  finality?: "confirmations" | "finalized";
  now?: () => number;
};
type Observation = {
  state: OrderStatus;
  reason: string | null;
  observed: BnbObservation;
  transferHash: Hex | null;
};
type BnbScheduleCandidate = {
  order_hash: Hex;
  reconcile_generation: string;
  job_state: string | null;
};
type IndexedBnbCandidate = BnbScheduleCandidate & {
  token_id: string;
  bound_transfer_hash: string;
};

export async function observeBnbOrder(
  pool: Pool,
  client: PublicClient,
  input: Awaited<ReturnType<typeof loadAcceptedBnbOrder>>,
  policy: BnbPolicy,
  options: Options
): Promise<Observation> {
  const state = await readBnbProtocolState(
    client,
    input,
    options.now,
    options.finality
  );
  let status: OrderStatus;
  let reason: string | null = null;
  let transferHash: Hex | null = null;
  // A completed fill remains a fill even if the maker subsequently cancels the hash.
  if (state.size > 0n && state.filled >= state.size) status = "filled";
  else if (state.cancelled) status = "cancelled";
  else if (state.counter !== input.order.counter) status = "counter-changed";
  else if (input.order.endTime <= state.observed.timestamp) status = "expired";
  else {
    try {
      const summary = checkBnbOrder(input, policy);
      const indexed = await readIndexedBnbAsset(pool, input.asset);
      transferHash = indexed.lastTransfer.transactionHash;
      await inspectBnbAdmission(
        client,
        input,
        summary,
        indexed,
        options,
        state
      );
      status = "active";
    } catch (error) {
      status = "unavailable";
      reason =
        error instanceof BnbOrderError
          ? error.code
          : "chain_or_indexer_unavailable";
    }
  }
  await assertBnbObservationCurrent(client, state.observed, options.now);
  return { state: status, reason, observed: state.observed, transferHash };
}

function jobKey(hash: string, generation: bigint) {
  return generation === 0n ? hash : `${hash}:${generation}`;
}

// Locks order rows first and never locks an existing active job. The worker
// locks its job before the order; avoiding that reverse lock order prevents deadlocks.
export async function scheduleBnbReconciliation(
  pool: Pool,
  limit = 100,
  scope?: Hex
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid reconciliation batch size.");
  const orderHash = scope ? bnbOrderIdentity("bnb", protocol, scope) : null;
  return transaction(pool, async (db) => {
    const due = await db.query<BnbScheduleCandidate>(
      `SELECT o.order_hash,o.reconcile_generation::text,j.state AS job_state FROM yunipals_market.orders o
      LEFT JOIN yunipals_market.job j ON j.kind='bnb_order_reconcile' AND j.deduplication_key=
        CASE WHEN o.reconcile_generation=0 THEN o.order_hash ELSE o.order_hash||':'||o.reconcile_generation::text END
      WHERE o.chain_id=56 AND o.protocol_address=$1 AND o.source='yunipals' AND o.publication_state='accepted'
        AND o.next_reconcile_at<=clock_timestamp()
        AND ($2::text IS NULL OR o.order_hash=$2)
      ORDER BY o.next_reconcile_at,o.order_hash
      LIMIT ${limit} FOR UPDATE OF o SKIP LOCKED`,
      [protocol, orderHash]
    );
    const rows = [...due.rows];
    const remaining = Math.min(limit - rows.length, indexedTransferBatchSize);
    if (remaining > 0) {
      const checked = await db.query<IndexedBnbCandidate>(
        `SELECT o.order_hash,o.reconcile_generation::text,j.state AS job_state,
          o.token_id::text AS token_id,o.bound_transfer_hash
        FROM yunipals_market.orders o
        LEFT JOIN yunipals_market.job j ON j.kind='bnb_order_reconcile' AND j.deduplication_key=
          CASE WHEN o.reconcile_generation=0 THEN o.order_hash ELSE o.order_hash||':'||o.reconcile_generation::text END
        WHERE o.chain_id=56 AND o.protocol_address=$1 AND o.source='yunipals'
          AND o.publication_state='accepted' AND o.bound_transfer_hash IS NOT NULL
          AND o.state IN ('active','unavailable')
          AND o.token_id IS NOT NULL AND ($2::text IS NULL OR o.order_hash=$2)
          AND NOT (o.order_hash=ANY($3::text[]))
          AND ($2::text IS NOT NULL OR
            o.indexed_transfer_checked_at<=clock_timestamp()-interval '1 minute')
        ORDER BY o.indexed_transfer_checked_at,o.order_hash
        LIMIT ${remaining} FOR UPDATE OF o SKIP LOCKED`,
        [protocol, orderHash, due.rows.map((row) => row.order_hash)]
      );
      if (checked.rows.length > 0) {
        const indexed = await readIndexedTransfers(
          db,
          "bnb",
          checked.rows.map((row) => row.token_id)
        );
        await db.query(
          `UPDATE yunipals_market.orders SET indexed_transfer_checked_at=clock_timestamp()
          WHERE chain_id=56 AND protocol_address=$1 AND order_hash=ANY($2::text[])`,
          [protocol, checked.rows.map((row) => row.order_hash)]
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
      let generation = BigInt(row.reconcile_generation);
      const retired =
        row.job_state === "failed" || row.job_state === "completed";
      if (retired) generation++;
      if (!row.job_state || retired)
        await enqueueJob(db, {
          kind: bnbReconcileKind,
          key: jobKey(row.order_hash, generation),
          payload: {
            chainId: 56,
            protocolAddress: protocol,
            orderHash: row.order_hash,
            generation: generation.toString()
          }
        });
      await db.query(
        `UPDATE yunipals_market.orders SET reconcile_generation=$3,next_reconcile_at=clock_timestamp()+interval '60 seconds',
        state=CASE WHEN $4 THEN 'unavailable' ELSE state END,
        state_reason=CASE WHEN $4 THEN 'reconciliation_job_retired' ELSE state_reason END,
        state_observed_at=CASE WHEN $4 THEN NULL ELSE state_observed_at END
        WHERE chain_id=56 AND protocol_address=$1 AND order_hash=$2`,
        [protocol, row.order_hash, generation.toString(), retired]
      );
    }
    return rows.length;
  });
}

export async function reconcileBnbJob(
  pool: Pool,
  client: PublicClient,
  policy: BnbPolicy,
  options: Options,
  job: Job
) {
  const hash = bnbOrderIdentity(
    "bnb",
    String(job.payload.protocolAddress),
    String(job.payload.orderHash)
  );
  const generationValue = job.payload.generation ?? "0";
  if (
    job.kind !== bnbReconcileKind ||
    job.payload.chainId !== 56 ||
    typeof generationValue !== "string" ||
    !/^(0|[1-9][0-9]{0,18})$/.test(generationValue) ||
    BigInt(generationValue) > 9223372036854775807n
  )
    throw new Error("Invalid BNB reconciliation job.");
  const generation = BigInt(generationValue);
  let input;
  try {
    input = await loadAcceptedBnbOrder(pool, hash);
  } catch (error) {
    if (error instanceof BnbOrderError && error.code === "order_not_found") {
      await completeJob(pool, job, async () => false);
      return;
    }
    throw error;
  }
  if (input.reconcileGeneration !== generation) {
    await completeJob(pool, job, async () => false);
    return;
  }
  let observation: Omit<Observation, "observed"> & {
    observed: BnbObservation | null;
  };
  try {
    observation = await observeBnbOrder(pool, client, input, policy, options);
  } catch (error) {
    if (rpcComputeBudgetError(error)) throw error;
    observation = {
      state: "unavailable",
      reason: error instanceof BnbOrderError ? error.code : "chain_unavailable",
      observed: null,
      transferHash: null
    };
  }
  return completeJob(pool, job, async (db) => {
    if (
      observation.observed &&
      (options.now?.() ?? Date.now()) - observation.observed.checkedAt >
        bnbObservationMaxAgeMs
    )
      observation = {
        state: "unavailable",
        reason: "observation_expired",
        observed: null,
        transferHash: observation.transferHash
      };
    const failed =
      observation.observed === null ||
      observation.reason === "chain_or_indexer_unavailable";
    const failures = failed ? Math.min(input.reconcileFailures + 1, 16) : 0;
    const delayMs = failed
      ? Math.min(21600000, 60000 * 2 ** Math.min(failures, 8))
      : bnbProjectionAuditDelayMs(hash);
    const observed = observation.observed;
    const updated = await db.query(
      `UPDATE yunipals_market.orders SET state=$4,state_reason=$5,state_observed_at=$6,
      state_block_number=$7,state_block_hash=$8,updated_at=clock_timestamp(),reconcile_generation=reconcile_generation+1,
      reconcile_failures=$9,bound_transfer_hash=coalesce($10,bound_transfer_hash),
      next_reconcile_at=clock_timestamp()+$11*interval '1 millisecond'
      WHERE chain_id=56 AND protocol_address=$1 AND order_hash=$2 AND reconcile_generation=$3`,
      [
        protocol,
        hash.toLowerCase(),
        generation.toString(),
        observation.state,
        observation.reason,
        observed ? new Date(observed.checkedAt) : null,
        observed?.number.toString() ?? null,
        observed?.hash.toLowerCase() ?? null,
        failures,
        observation.transferHash?.toLowerCase() ?? null,
        delayMs
      ]
    );
    return updated.rowCount === 1;
  });
}

const projectionAuditBaseMs = 6 * 60 * 60 * 1000;
const projectionAuditJitterMs = 60 * 60 * 1000;

export function bnbProjectionAuditDelayMs(orderHash: string) {
  const normalized = bnbOrderIdentity("bnb", protocol, orderHash);
  return (
    projectionAuditBaseMs +
    (Number.parseInt(normalized.slice(2, 10), 16) % projectionAuditJitterMs)
  );
}

export async function pruneBnbReconcileJobs(pool: Pool, limit = 100) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("Invalid cleanup batch size.");
  const result = await pool.query(`DELETE FROM yunipals_market.job WHERE id IN (
    SELECT j.id FROM yunipals_market.job j JOIN yunipals_market.orders o
      ON o.chain_id=56 AND o.protocol_address=lower(j.payload->>'protocolAddress') AND o.order_hash=lower(j.payload->>'orderHash')
    WHERE j.kind='bnb_order_reconcile' AND j.state='completed' AND j.updated_at<clock_timestamp()-interval '1 day'
      AND j.deduplication_key<>CASE WHEN o.reconcile_generation=0 THEN o.order_hash ELSE o.order_hash||':'||o.reconcile_generation::text END
    ORDER BY j.updated_at LIMIT ${limit} FOR UPDATE OF j SKIP LOCKED)`);
  return result.rowCount ?? 0;
}
