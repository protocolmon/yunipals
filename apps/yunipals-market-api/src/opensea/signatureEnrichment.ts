import type { Pool } from "pg";
import { getAddress, zeroAddress, type Address, type Hex } from "viem";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import {
  isOpenSeaChain,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";
import { hex, integer } from "@protopals/yunipals-market-core/validation";
import { claimJob, completeJob, LostJobLeaseError, retryJob } from "@/db/jobs";
import type { OpenSeaFulfillmentService } from "@/opensea/fulfillment";
import { loadOpenSeaFulfillmentCandidate } from "@/opensea/fulfillmentCandidate";
import { readIndexedOpenSeaAsset } from "@/opensea/indexer";
import { OpenSeaOrderError } from "@/opensea/orders";
import { isRpcComputeBudgetError } from "@/opensea/rpcComputeBudget";

const kind = "opensea_signature_enrichment";

// Reuse the durable queue; jobs contain identities only, never maker signatures
// or short-lived zone authorizations. A completed lifecycle/mint key stays done.
export async function enqueueMissingOpenSeaSignatures(
  pool: Pool,
  chain: OpenSeaChain,
  now = new Date(),
  orderHash?: Hex
) {
  if (!isOpenSeaChain(chain))
    throw new Error("Invalid signature enrichment chain.");
  const result = await pool.query<{ enqueued: number }>(
    `
    WITH candidates AS MATERIALIZED (
      SELECT d.chain_id,d.protocol_address,d.order_hash,d.first_seen_at,
        s.bound_lifecycle,s.bound_mint_hash,s.observed_at,s.next_reconcile_at,
        s.lease_until
      FROM yunipals_market.opensea_discovered_order d
      JOIN yunipals_market.opensea_discovered_state s USING(chain_id,protocol_address,order_hash)
      WHERE d.chain_id=$2 AND d.present AND d.provider_status='ACTIVE' AND d.classification='item'
        AND ($4::text IS NULL OR d.order_hash=$4)
        AND d.signature IS NULL AND (d.components->>'endTime')::numeric>extract(epoch FROM $3::timestamptz)
        AND d.last_seen_at BETWEEN $3::timestamptz-interval '300 seconds' AND $3::timestamptz+interval '30 seconds'
        AND s.state='authorization-required' AND s.reason='maker_signature_required'
        AND s.provider_seen_at=d.last_changed_at
        AND NOT EXISTS (SELECT 1 FROM yunipals_market.opensea_maker_signature m
          WHERE m.chain_id=d.chain_id AND m.protocol_address=d.protocol_address AND m.order_hash=d.order_hash
            AND m.lifecycle=s.bound_lifecycle AND m.mint_hash=s.bound_mint_hash)
        AND NOT EXISTS (SELECT 1 FROM yunipals_market.job j WHERE j.kind=$1
          AND j.deduplication_key=d.chain_id||':'||d.order_hash||':'||s.bound_lifecycle||':'||s.bound_mint_hash)
      ORDER BY d.first_seen_at,d.order_hash LIMIT 100
    -- A provider-budget pause can outlast the fresh projection window. Wake the
    -- read worker instead of allowing that unsigned order to wait for the next
    -- six-hour audit; the following fleet pass can then enqueue fresh evidence.
    ), wake AS (
      UPDATE yunipals_market.opensea_discovered_state s
      SET next_reconcile_at=least(s.next_reconcile_at,clock_timestamp())
      FROM candidates c
      WHERE s.chain_id=c.chain_id AND s.protocol_address=c.protocol_address AND s.order_hash=c.order_hash
        AND c.observed_at<$3::timestamptz-interval '60 seconds'
        AND c.next_reconcile_at>clock_timestamp()
        AND (c.lease_until IS NULL OR c.lease_until<=clock_timestamp())
      RETURNING 1
    ), inserted AS (
      INSERT INTO yunipals_market.job(kind,deduplication_key,payload,max_attempts)
      SELECT $1,c.chain_id||':'||c.order_hash||':'||c.bound_lifecycle||':'||c.bound_mint_hash,
        jsonb_build_object('chainId',c.chain_id,'orderHash',c.order_hash,
          'lifecycle',c.bound_lifecycle,'mintHash',c.bound_mint_hash),32
      FROM candidates c
      WHERE c.observed_at BETWEEN $3::timestamptz-interval '60 seconds' AND $3::timestamptz+interval '30 seconds'
      ON CONFLICT(kind,deduplication_key) DO NOTHING RETURNING 1
    ) SELECT count(*)::int AS enqueued FROM inserted`,
    [
      kind,
      marketplaceChains[chain].chainId,
      now,
      orderHash ? hex(orderHash, 32) : null
    ]
  );
  return result.rows[0]?.enqueued ?? 0;
}

export async function enrichNextOpenSeaSignature(input: {
  pool: Pool;
  chain: OpenSeaChain;
  listingActor: Address;
  service: Pick<OpenSeaFulfillmentService, "preflight">;
}) {
  if (
    !isOpenSeaChain(input.chain) ||
    getAddress(input.listingActor) === zeroAddress
  )
    throw new Error("Invalid signature enrichment scope or simulation actor.");
  const chainId = marketplaceChains[input.chain].chainId;
  const job = await claimJob(input.pool, kind, 90000, { chainId });
  if (!job) return { status: "idle" as const };
  try {
    const hash = hex(job.payload.orderHash, 32);
    const lifecycle = integer(job.payload.lifecycle, 2147483647);
    const mintHash = hex(job.payload.mintHash, 32);
    if (job.payload.chainId !== chainId)
      throw new Error("Invalid enrichment identity.");
    const candidate = await loadOpenSeaFulfillmentCandidate(
      input.pool,
      input.chain,
      hash
    );
    if (
      candidate.origin !== "discovered" ||
      candidate.summary.lifecycle !== lifecycle ||
      candidate.mintHash !== mintHash
    ) {
      await completeJob(input.pool, job, async () => undefined);
      return { status: "obsolete" as const };
    }
    const identity = [
      chainId,
      candidate.summary.protocolAddress.toLowerCase(),
      hash,
      lifecycle,
      mintHash
    ];
    const retained = () =>
      input.pool.query(
        `SELECT 1 FROM yunipals_market.opensea_maker_signature
      WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3 AND lifecycle=$4 AND mint_hash=$5`,
        identity
      );
    if ((await retained()).rowCount) {
      await completeJob(input.pool, job, async () => undefined);
      return { status: "already-retained" as const };
    }
    const actor =
      candidate.summary.side === "offer"
        ? (
            await readIndexedOpenSeaAsset(input.pool, {
              ...candidate.summary.asset,
              chain: input.chain
            })
          ).owner
        : getAddress(input.listingActor);
    // Only preflight: no approval, wallet send, settlement or publication. The
    // service independently verifies provider structure, policy, lifecycle,
    // canonical chain state and the maker's Seaport signature before retaining it.
    await input.service.preflight(input.chain, hash, { actor, lifecycle });
    if (!(await retained()).rowCount)
      throw new OpenSeaOrderError("maker_signature_required", 503);
    // Signature evidence commits independently under its source/lifecycle fence.
    // A crash here is recovered by the already-retained branch without another
    // provider request. Job completion never grants current trading eligibility.
    await completeJob(input.pool, job, async () => undefined);
    return { status: "retained" as const };
  } catch (error) {
    if (error instanceof LostJobLeaseError)
      return { status: "lease-lost" as const };
    const code = isRpcComputeBudgetError(error)
      ? "rpc_budget_exhausted"
      : error instanceof OpenSeaOrderError &&
          /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
        ? error.code
        : "signature_enrichment_failed";
    if (code === "provider_busy" || code === "rpc_budget_exhausted") {
      // The budget declined dispatch. Do not consume a processing attempt merely
      // because foreground work currently owns the account's remaining allowance.
      const result = await input.pool.query(
        `UPDATE yunipals_market.job SET state='pending',
        attempts=greatest(0,attempts-1),available_at=clock_timestamp()+CASE
          WHEN $3='rpc_budget_exhausted' THEN interval '5 minutes' ELSE interval '60 seconds' END,
        lease_token=NULL,lease_until=NULL,last_error_code=$3,updated_at=clock_timestamp()
        WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>clock_timestamp()`,
        [job.id, job.leaseToken, code]
      );
      return {
        status: result.rowCount
          ? ("deferred" as const)
          : ("lease-lost" as const),
        code
      };
    }
    const retried = await retryJob(
      input.pool,
      job,
      code,
      Math.min(3600000, 30000 * 2 ** Math.min(job.attempts - 1, 7))
    );
    return {
      status: retried
        ? job.attempts >= job.maxAttempts
          ? ("failed" as const)
          : ("retry-scheduled" as const)
        : ("lease-lost" as const),
      code
    };
  }
}
