import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Hex } from "viem";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import {
  address,
  decimal,
  hex,
  string
} from "@protopals/yunipals-market-core/validation";

import {
  completeJob,
  enqueueJob,
  LostJobLeaseError,
  type Job
} from "@/db/jobs";
import { transaction } from "@/db/pool";
import {
  OpenSeaError,
  type OpenSeaClient,
  type OpenSeaPublicationResult
} from "@/opensea/client";
import {
  snapshotOpenSeaPublication,
  verifyOpenSeaAcknowledgment,
  type OpenSeaAcknowledgment,
  type OpenSeaPublication
} from "@/opensea/orders";

export const openSeaSubmissionKind = "opensea_submission";
const protocol = seaportDeployment.address.toLowerCase();
type Queryable = Pick<PoolClient, "query">;
type Identity = { chainId: number; orderHash: Hex };
type Provider = Pick<OpenSeaClient, "lookup" | "publish">;
type PublicationState = "pending" | "accepted" | "rejected" | "indeterminate";
type AttemptState =
  | "queued"
  | "sending"
  | "accepted"
  | "rejected"
  | "indeterminate";

function identity(chainId: unknown, orderHash: unknown): Identity {
  if (typeof chainId !== "number" || ![1, 8453, 137].includes(chainId))
    throw new Error("Invalid OpenSea submission chain.");
  return { chainId, orderHash: hex(orderHash, 32) };
}

function parameters(id: Identity) {
  return [id.chainId, protocol, id.orderHash];
}
function key(id: Identity, generation: string) {
  return `${id.chainId}:${id.orderHash}:${generation}`;
}

async function enqueue(db: Queryable, id: Identity, generation: string) {
  return enqueueJob(db, {
    kind: openSeaSubmissionKind,
    key: key(id, generation),
    payload: { ...id, protocolAddress: protocol, generation }
  });
}

async function stored(db: Queryable, id: Identity, lock = false) {
  const result = await db.query<{
    components: OpenSeaPublication["order"];
    signature: Hex;
    summary: OpenSeaPublication["summary"];
    lifecycle: number;
    maker: string;
    contract_address: string;
    token_id: string;
    side: string;
    publication_state: PublicationState;
    reconcile_generation: string;
    reconcile_failures: number;
    provider_ack: OpenSeaAcknowledgment | null;
    accepted_at: Date | null;
    policy_version: string;
  }>(
    `SELECT components,signature,summary,lifecycle,maker,contract_address,token_id::text,side,
    publication_state,reconcile_generation::text,reconcile_failures,provider_ack,accepted_at,policy_version
    FROM yunipals_market.orders WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3 AND source='opensea'
    ${lock ? "FOR UPDATE" : ""}`,
    parameters(id)
  );
  const row = result.rows[0];
  if (!row) return null;
  const publication = snapshotOpenSeaPublication({
    order: row.components,
    signature: row.signature,
    summary: row.summary
  });
  const summary = publication.summary;
  if (
    summary.asset.chainId !== id.chainId ||
    summary.orderHash.toLowerCase() !== id.orderHash ||
    summary.lifecycle !== row.lifecycle ||
    summary.maker.toLowerCase() !== row.maker ||
    summary.asset.contractAddress.toLowerCase() !== row.contract_address ||
    summary.asset.tokenId !== row.token_id ||
    summary.side !== row.side
  )
    throw new Error("Stored OpenSea candidate mismatch.");
  if (row.publication_state === "accepted") {
    if (!row.provider_ack || !row.accepted_at)
      throw new Error("Stored OpenSea acceptance has no acknowledgment.");
    verifyAck(row.provider_ack, summary);
  }
  const attempt = await db.query<{ id: string; state: AttemptState }>(
    `SELECT id,state FROM yunipals_market.submission_attempt WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3
    ORDER BY created_at DESC,id DESC LIMIT 1`,
    parameters(id)
  );
  if (!attempt.rows[0])
    throw new Error("Stored OpenSea candidate has no submission history.");
  return {
    publication,
    policyVersion: row.policy_version,
    state: row.publication_state,
    generation: row.reconcile_generation,
    failures: row.reconcile_failures,
    attempt: attempt.rows[0]
  };
}

/**
 * Internal storage boundary, not public admission. The caller must already have
 * validated the prepared intent, maker signature, lifecycle/policy and chain
 * observation. Retention and its work commit together before any provider call.
 */
export type OpenSeaCandidateInput = {
  publication: OpenSeaPublication;
  policyVersion: string;
  admissionBlock: { number: string; hash: Hex };
};

export async function retainOpenSeaCandidate(
  pool: Pool,
  input: OpenSeaCandidateInput
) {
  // Snapshot before acquiring a connection, just as at the provider boundary.
  const snapshot = structuredClone(input);
  return transaction(pool, (db) =>
    retainOpenSeaCandidateInTransaction(db, snapshot)
  );
}

export async function retainOpenSeaCandidateInTransaction(
  db: PoolClient,
  input: OpenSeaCandidateInput
) {
  const publication = snapshotOpenSeaPublication(input.publication);
  const policyVersion = string(input.policyVersion, 256);
  const block = {
    number: decimal(input.admissionBlock.number),
    hash: hex(input.admissionBlock.hash, 32)
  };
  const { summary, order, signature } = publication;
  const id = identity(summary.asset.chainId, summary.orderHash);
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `opensea-retain:${key(id, "0")}`
  ]);
  const existing = await stored(db, id, true);
  if (existing) {
    if (existing.publication.summary.lifecycle !== summary.lifecycle)
      throw new Error("Existing signature belongs to another lifecycle.");
    // A retry never overwrites the original signature, policy or observation.
    return { ...id, state: existing.state, retained: false };
  }
  await db.query(
    `INSERT INTO yunipals_market.orders
      (chain_id,protocol_address,order_hash,contract_address,token_id,lifecycle,source,side,maker,currency,
      gross_amount,seller_proceeds,start_time,end_time,counter,components,signature,summary,policy_version,
      publication_state,admission_block_number,admission_block_hash)
      VALUES($1,$2,$3,$4,$5,$6,'opensea',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending',$19,$20)`,
    [
      ...parameters(id),
      summary.asset.contractAddress.toLowerCase(),
      summary.asset.tokenId,
      summary.lifecycle,
      summary.side,
      summary.maker.toLowerCase(),
      summary.currency.address.toLowerCase(),
      summary.grossAmount,
      summary.sellerProceeds,
      summary.startTime,
      summary.endTime,
      order.counter,
      JSON.stringify(order),
      signature,
      JSON.stringify({ ...summary, status: "unavailable" }),
      policyVersion,
      block.number,
      block.hash
    ]
  );
  await db.query(
    `INSERT INTO yunipals_market.submission_attempt(id,chain_id,protocol_address,order_hash,state)
      VALUES($1,$2,$3,$4,'queued')`,
    [randomUUID(), ...parameters(id)]
  );
  await enqueue(db, id, "0");
  return { ...id, state: "pending" as const, retained: true };
}

export async function readRetainedOpenSeaCandidate(
  pool: Queryable,
  chainId: number,
  orderHash: Hex
) {
  return stored(pool, identity(chainId, orderHash));
}

// Never lock existing jobs while holding an order row: processors acquire the
// job first. A retired job advances generation; active jobs are left untouched.
export async function scheduleOpenSeaSubmissions(
  pool: Pool,
  limit = 100,
  scope?: { chainId: number; orderHash?: Hex }
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid submission batch size.");
  const filter = scope
    ? {
        chainId: identity(
          scope.chainId,
          scope.orderHash ?? `0x${"00".repeat(32)}`
        ).chainId,
        orderHash: scope.orderHash ? hex(scope.orderHash, 32) : undefined
      }
    : undefined;
  return transaction(pool, async (db) => {
    const rows = await db.query<{
      chain_id: number;
      order_hash: Hex;
      generation: string;
      job_state: string | null;
    }>(
      `SELECT o.chain_id,o.order_hash,o.reconcile_generation::text AS generation,j.state AS job_state
      FROM yunipals_market.orders o LEFT JOIN yunipals_market.job j ON j.kind='opensea_submission'
        AND j.deduplication_key=o.chain_id::text||':'||o.order_hash||':'||o.reconcile_generation::text
      WHERE o.source='opensea' AND o.chain_id IN (1,8453,137) AND o.protocol_address=$1
        AND o.publication_state IN ('pending','indeterminate') AND o.next_reconcile_at<=clock_timestamp()
        ${filter ? `AND o.chain_id=$2${filter.orderHash ? " AND o.order_hash=$3" : ""}` : ""}
      ORDER BY o.next_reconcile_at,o.chain_id,o.order_hash LIMIT ${limit} FOR UPDATE OF o SKIP LOCKED`,
      filter
        ? [
            protocol,
            filter.chainId,
            ...(filter.orderHash ? [filter.orderHash] : [])
          ]
        : [protocol]
    );
    for (const row of rows.rows) {
      const id = identity(row.chain_id, row.order_hash);
      const retired =
        row.job_state === "failed" || row.job_state === "completed";
      const generation = (
        BigInt(row.generation) + (retired ? 1n : 0n)
      ).toString();
      if (!row.job_state || retired) await enqueue(db, id, generation);
      await db.query(
        `UPDATE yunipals_market.orders SET reconcile_generation=$4,
        next_reconcile_at=clock_timestamp()+interval '60 seconds'
        WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3`,
        [...parameters(id), generation]
      );
    }
    return rows.rowCount ?? 0;
  });
}

async function markSending(
  pool: Pool,
  job: Job,
  id: Identity,
  generation: string
) {
  return transaction(pool, async (db) => {
    const lease = await db.query(
      `SELECT id FROM yunipals_market.job WHERE id=$1 AND lease_token=$2
      AND state='running' AND lease_until>clock_timestamp() FOR UPDATE`,
      [job.id, job.leaseToken]
    );
    if (lease.rowCount !== 1) throw new LostJobLeaseError();
    const row = await stored(db, id, true);
    if (
      !row ||
      row.generation !== generation ||
      row.state !== "pending" ||
      row.attempt.state !== "queued"
    )
      return false;
    // Commit uncertainty BEFORE the remote call. A crash after this point can
    // only cause lookup/reconciliation, never a blind second publication.
    await db.query(
      "UPDATE yunipals_market.submission_attempt SET state='sending',updated_at=clock_timestamp() WHERE id=$1",
      [row.attempt.id]
    );
    await db.query(
      `UPDATE yunipals_market.orders SET publication_state='indeterminate',updated_at=clock_timestamp()
      WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3`,
      parameters(id)
    );
    // A slow transaction must not grant a send to a worker whose lease expired.
    const valid = await db.query(
      "SELECT 1 FROM yunipals_market.job WHERE id=$1 AND lease_until>clock_timestamp()",
      [job.id]
    );
    if (valid.rowCount !== 1) throw new LostJobLeaseError();
    return true;
  });
}

function verifyAck(
  ack: OpenSeaAcknowledgment,
  expected: OpenSeaPublication["summary"]
) {
  if (
    ack.schemaVersion !== 1 ||
    ack.source !== "opensea" ||
    ack.chainId !== expected.asset.chainId
  )
    throw new Error("Invalid provider acknowledgment.");
  return verifyOpenSeaAcknowledgment(
    {
      chain: ack.chain,
      order_hash: ack.orderHash,
      protocol_address: ack.protocolAddress,
      maker: { address: ack.maker },
      protocol_data: {
        parameters: {
          ...ack.order,
          totalOriginalConsiderationItems: ack.order.consideration.length
        }
      },
      status: ack.providerStatus,
      remaining_quantity: ack.remainingQuantity
    },
    expected,
    new Date(ack.observedAt)
  );
}

export async function processOpenSeaSubmission(
  pool: Pool,
  provider: Provider,
  job: Job
) {
  const id = identity(job.payload.chainId, job.payload.orderHash);
  const generation = decimal(job.payload.generation);
  if (
    job.kind !== openSeaSubmissionKind ||
    address(job.payload.protocolAddress).toLowerCase() !== protocol ||
    BigInt(generation) > 9223372036854775807n
  )
    throw new Error("Invalid OpenSea submission job.");
  const input = await stored(pool, id);
  if (
    !input ||
    input.generation !== generation ||
    ["accepted", "rejected"].includes(input.state)
  )
    return completeJob(pool, job, async () => false);
  let outcome: OpenSeaPublicationResult;
  let sentByThisJob = false;
  try {
    const found = await provider.lookup(input.publication.summary);
    if (found)
      outcome = {
        state: "acknowledged",
        acknowledgment: verifyAck(found, input.publication.summary)
      };
    else {
      sentByThisJob = await markSending(pool, job, id, generation);
      outcome = sentByThisJob
        ? await provider.publish(input.publication)
        : { state: "indeterminate", code: "provider_not_found" };
      if (outcome.state === "acknowledged")
        outcome.acknowledgment = verifyAck(
          outcome.acknowledgment,
          input.publication.summary
        );
    }
  } catch (error) {
    if (error instanceof LostJobLeaseError) throw error;
    outcome = {
      state: "indeterminate",
      code:
        error instanceof OpenSeaError ? error.code : "provider_invalid_response"
    };
  }
  return completeJob(pool, job, async (db) => {
    const current = await stored(db, id, true);
    if (
      !current ||
      current.generation !== generation ||
      ["accepted", "rejected"].includes(current.state)
    )
      return false;
    let state: PublicationState;
    let attemptState: AttemptState;
    if (outcome.state === "acknowledged") {
      state = "accepted";
      attemptState = "accepted";
    } else if (outcome.state === "rejected" && sentByThisJob) {
      state = "rejected";
      attemptState = "rejected";
    } else if (
      (outcome.state === "not_sent" && sentByThisJob) ||
      current.attempt.state === "queued"
    ) {
      state = "pending";
      attemptState = "queued";
    } else {
      state = "indeterminate";
      attemptState = "indeterminate";
    }
    const ack =
      outcome.state === "acknowledged" ? outcome.acknowledgment : null;
    const failures = ack ? 0 : Math.min(current.failures + 1, 16);
    const retry =
      outcome.state !== "acknowledged" ? (outcome.retryAfterMs ?? 0) : 0;
    const delayMs = ack
      ? 0
      : Math.max(
          Math.min(300000, 10000 * 2 ** Math.min(failures, 5)),
          Math.min(retry, 3600000)
        );
    const code = outcome.state === "acknowledged" ? null : outcome.code;
    await db.query(
      `UPDATE yunipals_market.submission_attempt SET state=$2,error_code=$3,updated_at=clock_timestamp() WHERE id=$1`,
      [current.attempt.id, attemptState, code]
    );
    await db.query(
      `UPDATE yunipals_market.orders SET publication_state=$4,provider_ack=$5,
      accepted_at=CASE WHEN $4='accepted' THEN clock_timestamp() ELSE NULL END,
      state='unavailable',state_reason=$6,updated_at=clock_timestamp(),reconcile_generation=reconcile_generation+1,
      reconcile_failures=$7,next_reconcile_at=clock_timestamp()+$8*interval '1 millisecond'
      WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3`,
      [
        ...parameters(id),
        state,
        ack ? JSON.stringify(ack) : null,
        ack ? "provider_accepted_awaiting_chain" : code,
        failures,
        delayMs
      ]
    );
    return state;
  });
}

export async function pruneOpenSeaSubmissionJobs(pool: Pool, limit = 100) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("Invalid submission cleanup batch size.");
  const result = await pool.query(`DELETE FROM yunipals_market.job WHERE id IN (
    SELECT j.id FROM yunipals_market.job j JOIN yunipals_market.orders o
      ON o.chain_id::text=j.payload->>'chainId' AND o.protocol_address=lower(j.payload->>'protocolAddress')
      AND o.order_hash=lower(j.payload->>'orderHash')
    WHERE j.kind='opensea_submission' AND j.state='completed' AND j.updated_at<clock_timestamp()-interval '1 day'
      AND j.deduplication_key<>o.chain_id::text||':'||o.order_hash||':'||o.reconcile_generation::text
    ORDER BY j.updated_at LIMIT ${limit} FOR UPDATE OF j SKIP LOCKED)`);
  return result.rowCount ?? 0;
}
