import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import { getAddress, zeroAddress, type Hex, type PublicClient } from "viem";
import type { MarketOrder } from "@protopals/yunipals-market-core/marketOrder";
import {
  isOpenSeaChain,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";
import {
  assertOpenSeaPolicyCurrent,
  type OpenSeaOrderPolicy
} from "@protopals/yunipals-market-core/openseaOrderPolicy";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import { decodeSeaportOrder } from "@protopals/yunipals-market-core/seaportWire";
import { hex } from "@protopals/yunipals-market-core/validation";

import { transaction } from "@/db/pool";
import { LostJobLeaseError } from "@/db/jobs";
import {
  indexedTransferBatchSize,
  readIndexedTransfers
} from "@/db/indexedTransfers";
import {
  assertOpenSeaObservationCurrent,
  inspectOpenSeaAdmission,
  readOpenSeaProtocolState,
  type OpenSeaObservation,
  type OpenSeaObservationOptions
} from "@/opensea/chain";
import {
  parseOpenSeaDiscoveredOrder,
  summarizeDiscoveredOpenSeaOrder
} from "@/opensea/discoveryOrder";
import { readIndexedOpenSeaAsset } from "@/opensea/indexer";
import { OpenSeaOrderError, parseOpenSeaOrderRequest } from "@/opensea/orders";
import type { OpenSeaPolicyResolver } from "@/opensea/policy";
import { discoveredStreamWakeSql } from "@/opensea/streamWake";

type Policies = Pick<OpenSeaPolicyResolver, "resolve">;
export type DiscoveredObservationOptions = OpenSeaObservationOptions & {
  providerMaxAgeMs: number;
  enabledFulfillmentSides?: Partial<
    Record<OpenSeaChain, readonly ("listing" | "offer")[]>
  >;
};
export type DiscoveredOrderClaim = {
  chain_id: number;
  protocol_address: Hex;
  order_hash: Hex;
  generation: string;
  lease_token: string;
  failures: number;
  stream_sequence: string;
};
type IndexedProjectionCandidate = {
  chain_id: number;
  protocol_address: Hex;
  order_hash: Hex;
  token_id: string;
  bound_lifecycle: number;
  bound_transfer_hash: string | null;
  stream_sequence: string;
};
type SourceRow = {
  components: unknown;
  signature: Hex | null;
  provider_observation: unknown;
  side: "listing" | "offer";
  classification: string;
  token_id: string | null;
  contract_address: string;
  maker: string;
  provider_status: string;
  present: boolean;
  last_seen_at: Date;
  provider_version: string;
  bound_lifecycle: number | null;
  bound_mint_hash: Hex | null;
};
type Observation = {
  state:
    | "eligible"
    | "authorization-required"
    | "unavailable"
    | "filled"
    | "cancelled"
    | "counter-changed"
    | "expired";
  reason: string | null;
  observed: OpenSeaObservation | null;
  summary: MarketOrder | null;
  lifecycle: number | null;
  mintHash: Hex | null;
  transferHash: Hex | null;
  policyVersion: string | null;
};
const protocol = seaportDeployment.address.toLowerCase();
// Background projections and signature proof are never executable quotes.
// Cost-controlled RPC pacing can serialize their pinned reads beyond the
// interactive ten-second limit, so retain a bounded minute after rechecking the
// exact canonical block. Admission and fulfillment keep the ten-second default.
export const openSeaProjectionObservationMaxAgeMs = 60000;
export const openSeaProjectionLeaseMs = 90000;
const unavailable = (reason: string): Observation => ({
  state: "unavailable",
  reason,
  observed: null,
  summary: null,
  lifecycle: null,
  mintHash: null,
  transferHash: null,
  policyVersion: null
});

// Imported orders must satisfy current required economics, but need not reproduce
// our publication builder byte for byte. Preserve signed optional fees, ordering,
// partial-order flags, salt and duration. Checkout reviews every signed payment.
export function checkDiscoveredOpenSeaPolicy(
  summary: MarketOrder,
  order: ReturnType<typeof decodeSeaportOrder>,
  policy: OpenSeaOrderPolicy,
  now: bigint
) {
  try {
    assertOpenSeaPolicyCurrent(policy, now);
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    if (
      policy.chain !== summary.asset.chain ||
      !same(policy.collection, summary.asset.contractAddress) ||
      order.startTime > now ||
      order.endTime <= now ||
      !same(
        order.zone,
        summary.side === "listing" ? policy.listingZone : policy.offerZone
      ) ||
      !(
        summary.side === "listing"
          ? policy.listingCurrencies
          : [policy.offerCurrency]
      ).some((c) => same(c, summary.currency.address))
    )
      throw new Error();
    const required = new Map<string, bigint>();
    for (const fee of policy.fees) {
      const recipient = fee.recipient.toLowerCase();
      const amount =
        (BigInt(summary.grossAmount) * BigInt(fee.basisPoints)) / 10000n;
      required.set(recipient, (required.get(recipient) ?? 0n) + amount);
    }
    for (const [recipient, amount] of required) {
      const actual = summary.fees
        .filter((f) => same(f.recipient, recipient))
        .reduce((sum, f) => sum + BigInt(f.amount), 0n);
      if (actual < amount) throw new Error();
    }
  } catch {
    throw new OpenSeaOrderError("order_policy_rejected", 400);
  }
}

// A projection lease never changes provider provenance or creates local admission.
// Bootstrap at most 100 missing projections per claim; all scopes remain pageable.
export async function claimDiscoveredOpenSeaOrder(
  pool: Pool,
  chain: OpenSeaChain,
  leaseMs = 30000,
  orderHash?: Hex
): Promise<DiscoveredOrderClaim | null> {
  if (
    !isOpenSeaChain(chain) ||
    !Number.isSafeInteger(leaseMs) ||
    leaseMs < 1000 ||
    leaseMs > 90000
  )
    throw new Error("Invalid discovered reconciliation scope.");
  const chainId = marketplaceChains[chain].chainId;
  const scope = orderHash ? hex(orderHash, 32) : null;
  // A new provider version wakes a healthy projection before its periodic time.
  // Keep failure backoff and order by effective due time, so fresh ingestion
  // cannot jump ahead of older overdue work. Only the projection is row-locked.
  const sourceDueAt = `CASE WHEN s.failures=0 AND s.state IN ('eligible','authorization-required')
    AND s.provider_seen_at IS DISTINCT FROM d.last_changed_at
    THEN least(s.next_reconcile_at,d.last_changed_at) ELSE s.next_reconcile_at END`;
  const wakeVersion = discoveredStreamWakeSql.version;
  const wakeRequestedAt = discoveredStreamWakeSql.requestedAt;
  const dueAt = `least(${sourceDueAt},coalesce(${wakeRequestedAt},${sourceDueAt}))`;
  return transaction(pool, async (db) => {
    await db.query(
      `INSERT INTO yunipals_market.opensea_discovered_state(chain_id,protocol_address,order_hash)
      SELECT d.chain_id,d.protocol_address,d.order_hash FROM yunipals_market.opensea_discovered_order d
      WHERE d.chain_id=$1 AND ($2::text IS NULL OR d.order_hash=$2) AND NOT EXISTS (
        SELECT 1 FROM yunipals_market.opensea_discovered_state s WHERE s.chain_id=d.chain_id AND s.protocol_address=d.protocol_address AND s.order_hash=d.order_hash)
      ORDER BY d.first_seen_at,d.order_hash LIMIT 100 ON CONFLICT DO NOTHING`,
      [chainId, scope]
    );
    const leaseToken = randomUUID();
    const result = await db.query<DiscoveredOrderClaim>(
      `WITH candidate AS (SELECT s.chain_id,s.protocol_address,s.order_hash,${wakeVersion} AS stream_sequence
        FROM yunipals_market.opensea_discovered_state s
        JOIN yunipals_market.opensea_discovered_order d USING(chain_id,protocol_address,order_hash)
        ${discoveredStreamWakeSql.joins}
        WHERE s.chain_id=$1 AND ($2::text IS NULL OR s.order_hash=$2) AND (
          (${dueAt})<=clock_timestamp() OR ${wakeVersion}>s.stream_ack_seq)
          AND s.terminal_at IS NULL
          AND (s.lease_until IS NULL OR s.lease_until<=clock_timestamp())
        ORDER BY (${dueAt}),s.order_hash LIMIT 1 FOR UPDATE OF s SKIP LOCKED)
      UPDATE yunipals_market.opensea_discovered_state s SET
        generation=s.generation+1,lease_token=$3,lease_until=clock_timestamp()+$4*interval '1 millisecond'
      FROM candidate c WHERE s.chain_id=c.chain_id AND s.protocol_address=c.protocol_address AND s.order_hash=c.order_hash
      RETURNING s.chain_id,s.protocol_address,s.order_hash,s.generation::text,s.lease_token,s.failures,
        c.stream_sequence::text`,
      [chainId, scope, leaseToken, leaseMs]
    );
    if (result.rows[0]) return result.rows[0];

    const candidates = await db.query<IndexedProjectionCandidate>(
      `SELECT s.chain_id,s.protocol_address,s.order_hash,d.token_id::text AS token_id,
        s.bound_lifecycle,s.bound_transfer_hash,${wakeVersion}::text AS stream_sequence
      FROM yunipals_market.opensea_discovered_state s
      JOIN yunipals_market.opensea_discovered_order d USING(chain_id,protocol_address,order_hash)
      ${discoveredStreamWakeSql.joins}
      WHERE s.chain_id=$1 AND ($2::text IS NULL OR s.order_hash=$2)
        AND s.terminal_at IS NULL
        AND s.bound_lifecycle IS NOT NULL AND d.token_id IS NOT NULL
        AND (s.lease_until IS NULL OR s.lease_until<=clock_timestamp())
        AND ($2::text IS NOT NULL OR
          s.indexed_transfer_checked_at<=clock_timestamp()-interval '1 minute')
      ORDER BY s.indexed_transfer_checked_at,s.order_hash
      LIMIT ${indexedTransferBatchSize} FOR UPDATE OF s SKIP LOCKED`,
      [chainId, scope]
    );
    if (candidates.rows.length === 0) return null;
    const indexed = await readIndexedTransfers(
      db,
      chain,
      candidates.rows.map((candidate) => candidate.token_id)
    );
    await markIndexedProjectionChecks(db, chainId, candidates.rows);
    const changed = candidates.rows.find((candidate) => {
      const token = indexed.get(candidate.token_id);
      return (
        token?.lifecycle !== candidate.bound_lifecycle ||
        (token?.transactionHash ?? null) !== candidate.bound_transfer_hash
      );
    });
    if (!changed) return null;
    const claimed = await db.query<DiscoveredOrderClaim>(
      `UPDATE yunipals_market.opensea_discovered_state SET
        generation=generation+1,lease_token=$4,
        lease_until=clock_timestamp()+$5*interval '1 millisecond'
      WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3
      RETURNING chain_id,protocol_address,order_hash,generation::text,lease_token,failures`,
      [
        changed.chain_id,
        changed.protocol_address,
        changed.order_hash,
        leaseToken,
        leaseMs
      ]
    );
    return claimed.rows[0]
      ? {
          ...claimed.rows[0],
          stream_sequence: changed.stream_sequence
        }
      : null;
  });
}

async function markIndexedProjectionChecks(
  db: PoolClient,
  chainId: number,
  candidates: readonly IndexedProjectionCandidate[]
) {
  await db.query(
    `WITH checked(protocol_address,order_hash) AS (
      SELECT * FROM unnest($2::text[],$3::text[])
    ) UPDATE yunipals_market.opensea_discovered_state s SET
      indexed_transfer_checked_at=clock_timestamp()
    FROM checked c WHERE s.chain_id=$1
      AND s.protocol_address=c.protocol_address AND s.order_hash=c.order_hash`,
    [
      chainId,
      candidates.map((candidate) => candidate.protocol_address),
      candidates.map((candidate) => candidate.order_hash)
    ]
  );
}

async function observe(
  pool: Pool,
  client: PublicClient,
  chain: OpenSeaChain,
  claim: DiscoveredOrderClaim,
  source: SourceRow,
  policies: Policies,
  options: DiscoveredObservationOptions
): Promise<Observation> {
  if (claim.protocol_address !== protocol || source.classification !== "item")
    return unavailable("unsupported_discovered_order");
  const parsed = parseOpenSeaDiscoveredOrder(
    source.provider_observation,
    chain,
    source.side
  );
  if (
    parsed.classification !== "item" ||
    parsed.orderHash !== claim.order_hash ||
    parsed.protocolAddress !== claim.protocol_address ||
    parsed.tokenId !== source.token_id ||
    parsed.contractAddress !== source.contract_address ||
    parsed.maker !== source.maker ||
    parsed.providerStatus !== source.provider_status ||
    !isDeepStrictEqual(parsed.components, source.components)
  )
    throw new OpenSeaOrderError("discovery_identity_conflict");
  const order = decodeSeaportOrder(parsed.components);
  const config = marketplaceChains[chain];
  // Protocol-only terminal checks do not claim an indexed lifecycle.
  const input = {
    ...parseOpenSeaOrderRequest({
      asset: {
        chain,
        chainId: config.chainId,
        contractAddress: config.contractAddress,
        tokenId: parsed.tokenId
      },
      lifecycle: source.bound_lifecycle ?? 0,
      order: parsed.components,
      policyVersion: "discovered-observation"
    }),
    signature: source.signature ?? undefined
  };
  const policy = await policies.resolve(chain).catch(() => null);
  const state = await readOpenSeaProtocolState(
    client,
    input,
    options.now,
    undefined,
    options.evidence,
    options.finality
  );
  let result: Observation = {
    ...unavailable("chain_or_indexer_unavailable"),
    observed: state.observed
  };
  if (state.size > 0n && state.filled >= state.size)
    result = { ...result, state: "filled", reason: null };
  else if (state.cancelled)
    result = { ...result, state: "cancelled", reason: null };
  else if (state.counter !== order.counter)
    result = { ...result, state: "counter-changed", reason: null };
  else if (order.endTime <= state.observed.timestamp)
    result = { ...result, state: "expired", reason: null };
  else {
    try {
      const providerAge =
        (options.now?.() ?? Date.now()) - source.last_seen_at.getTime();
      if (
        !source.present ||
        source.provider_status !== "ACTIVE" ||
        parsed.remainingQuantity !== 1
      )
        throw new OpenSeaOrderError("provider_order_unavailable", 503);
      if (providerAge < -30000 || providerAge > options.providerMaxAgeMs)
        throw new OpenSeaOrderError("provider_observation_stale", 503);
      if (!policy)
        throw new OpenSeaOrderError("provider_policy_unavailable", 503);
      const indexed = await readIndexedOpenSeaAsset(pool, input.asset);
      if (
        source.bound_lifecycle !== null &&
        (source.bound_lifecycle !== indexed.lifecycle ||
          source.bound_mint_hash !== indexed.mint.transactionHash)
      )
        throw new OpenSeaOrderError("asset_changed");
      input.lifecycle = indexed.lifecycle;
      input.policyVersion = policy.policy.version;
      const summary = summarizeDiscoveredOpenSeaOrder(
        order,
        chain,
        source.side,
        getAddress(claim.protocol_address),
        indexed.lifecycle
      );
      const timestamp = () =>
        BigInt(
          Math.max(
            Math.floor((options.now?.() ?? Date.now()) / 1000),
            Number(state.observed.timestamp)
          )
        );
      checkDiscoveredOpenSeaPolicy(summary, order, policy.policy, timestamp());
      await inspectOpenSeaAdmission(
        client,
        input,
        indexed,
        {
          ...options,
          observationMaxAgeMs: openSeaProjectionObservationMaxAgeMs
        },
        state.observed,
        state
      );
      // A signature does not bind the repository's lifecycle. A previously unseen
      // order predating the current mint cannot silently attach to a reminted NFT.
      const mint = await client.getBlock({
        blockNumber: indexed.mint.blockNumber
      });
      if (order.startTime < mint.timestamp)
        throw new OpenSeaOrderError("order_predates_lifecycle");
      const current = await readIndexedOpenSeaAsset(pool, input.asset);
      const { checkpoint: before, ...previousAsset } = indexed;
      const { checkpoint: after, ...currentAsset } = current;
      if (
        !isDeepStrictEqual(previousAsset, currentAsset) ||
        after.number < before.number ||
        after.heartbeatAt < before.heartbeatAt
      )
        throw new OpenSeaOrderError("asset_still_syncing", 503);
      checkDiscoveredOpenSeaPolicy(summary, order, policy.policy, timestamp());
      const reason =
        !source.signature && !state.validated
          ? "maker_signature_required"
          : order.orderType >= 2
            ? "provider_authorization_required"
            : null;
      result = {
        state: reason ? "authorization-required" : "eligible",
        reason,
        observed: state.observed,
        summary,
        lifecycle: indexed.lifecycle,
        mintHash: indexed.mint.transactionHash,
        transferHash: indexed.lastTransfer.transactionHash,
        policyVersion: policy.policy.version
      };
    } catch (error) {
      result.reason =
        error instanceof OpenSeaOrderError
          ? error.code
          : "chain_or_indexer_unavailable";
    }
  }
  await assertOpenSeaObservationCurrent(
    client,
    state.observed,
    options.now,
    openSeaProjectionObservationMaxAgeMs
  );
  return result;
}

export async function reconcileDiscoveredOpenSeaOrder(
  pool: Pool,
  client: PublicClient,
  chain: OpenSeaChain,
  policies: Policies,
  options: DiscoveredObservationOptions,
  claim: DiscoveredOrderClaim
) {
  if (
    !isOpenSeaChain(chain) ||
    claim.chain_id !== marketplaceChains[chain].chainId ||
    !Number.isSafeInteger(options.providerMaxAgeMs) ||
    options.providerMaxAgeMs < 1000 ||
    options.providerMaxAgeMs > 600000
  )
    throw new Error("Invalid discovered observation settings.");
  const identity = [claim.chain_id, claim.protocol_address, claim.order_hash];
  const selected = await pool.query<SourceRow>(
    `SELECT d.*,coalesce(m.signature,d.signature) AS signature,d.token_id::text,d.last_changed_at::text AS provider_version,s.bound_lifecycle,s.bound_mint_hash
    FROM yunipals_market.opensea_discovered_order d JOIN yunipals_market.opensea_discovered_state s USING(chain_id,protocol_address,order_hash)
    LEFT JOIN yunipals_market.opensea_maker_signature m USING(chain_id,protocol_address,order_hash)
    WHERE d.chain_id=$1 AND d.protocol_address=$2 AND d.order_hash=$3`,
    identity
  );
  const source = selected.rows[0];
  if (!source) throw new OpenSeaOrderError("discovered_order_not_found", 404);
  let observation: Observation;
  try {
    observation = await observe(
      pool,
      client,
      chain,
      claim,
      source,
      policies,
      options
    );
  } catch (error) {
    observation = unavailable(
      error instanceof OpenSeaOrderError ? error.code : "chain_unavailable"
    );
  }
  return transaction(pool, async (db) => {
    const locked = await db.query(
      `SELECT 1 FROM yunipals_market.opensea_discovered_state
      WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3 AND generation=$4 AND lease_token=$5 AND lease_until>clock_timestamp() FOR UPDATE`,
      [...identity, claim.generation, claim.lease_token]
    );
    if (locked.rowCount !== 1) throw new LostJobLeaseError();
    const current = await db.query<SourceRow>(
      `SELECT d.*,coalesce(m.signature,d.signature) AS signature,d.token_id::text,d.last_changed_at::text AS provider_version
      FROM yunipals_market.opensea_discovered_order d LEFT JOIN yunipals_market.opensea_maker_signature m USING(chain_id,protocol_address,order_hash)
      WHERE d.chain_id=$1 AND d.protocol_address=$2 AND d.order_hash=$3`,
      identity
    );
    const row = current.rows[0]!;
    // Fence substantive collector changes, including changed-then-restored data.
    // Identical refreshes only renew last_seen_at and keep this version stable.
    // Keep source reads SELECT-only. A collector commit after this check leaves
    // our saved original provider_seen_at stale; financial reads require it to
    // match before using this projection. Fulfillment independently reinspects
    // the current provider version, indexed lifecycle and onchain state.
    const changed =
      source.provider_version !== row.provider_version ||
      source.present !== row.present ||
      source.signature !== row.signature ||
      source.classification !== row.classification ||
      source.provider_status !== row.provider_status ||
      !isDeepStrictEqual(
        source.provider_observation,
        row.provider_observation
      ) ||
      !isDeepStrictEqual(source.components, row.components);
    if (changed)
      observation = unavailable("discovery_changed_during_observation");
    const age = observation.observed
      ? (options.now?.() ?? Date.now()) - observation.observed.checkedAt
      : 0;
    if (
      observation.observed &&
      (age < 0 || age > openSeaProjectionObservationMaxAgeMs)
    )
      observation = unavailable("observation_expired");
    if (
      ["eligible", "authorization-required"].includes(observation.state) &&
      (options.now?.() ?? Date.now()) - source.last_seen_at.getTime() >
        options.providerMaxAgeMs
    )
      observation = unavailable("provider_observation_stale");
    const failures =
      observation.state === "unavailable"
        ? Math.min(claim.failures + 1, 16)
        : 0;
    const delayMs = changed
      ? 1000
      : failures
        ? openSeaTransientRetryDelayMs(claim.order_hash, failures)
        : openSeaProjectionAuditDelayMs(claim.order_hash);
    const result = await db.query(
      `UPDATE yunipals_market.opensea_discovered_state SET state=$6,reason=$7,
      bound_lifecycle=coalesce(bound_lifecycle,$8),bound_mint_hash=coalesce(bound_mint_hash,$9),
      bound_transfer_hash=coalesce($10,bound_transfer_hash),summary=$11,policy_version=$12,
      observed_at=$13,block_number=$14,block_hash=$15,provider_seen_at=$16,failures=$17,
      next_reconcile_at=CASE WHEN $6='expired' THEN 'infinity'::timestamptz
        ELSE clock_timestamp()+$18*interval '1 millisecond' END,
      terminal_at=CASE WHEN $6='expired' THEN coalesce(terminal_at,clock_timestamp()) ELSE terminal_at END,
      terminal_reason=CASE WHEN $6='expired' THEN 'expired' ELSE terminal_reason END,
      stream_ack_seq=greatest(stream_ack_seq,$19::bigint),lease_token=NULL,lease_until=NULL
      WHERE chain_id=$1 AND protocol_address=$2 AND order_hash=$3 AND generation=$4 AND lease_token=$5 AND lease_until>clock_timestamp()`,
      [
        ...identity,
        claim.generation,
        claim.lease_token,
        observation.state,
        observation.reason,
        observation.lifecycle,
        observation.mintHash,
        observation.transferHash,
        observation.summary ? JSON.stringify(observation.summary) : null,
        observation.policyVersion,
        observation.observed ? new Date(observation.observed.checkedAt) : null,
        observation.observed?.number.toString() ?? null,
        observation.observed?.hash.toLowerCase() ?? null,
        source.provider_version,
        failures,
        delayMs,
        claim.stream_sequence ?? "0"
      ]
    );
    if (result.rowCount !== 1) throw new LostJobLeaseError();
    return observation;
  });
}

const projectionAuditBaseMs = 6 * 60 * 60 * 1000;
const projectionAuditJitterMs = 60 * 60 * 1000;

export function openSeaTransientRetryDelayMs(
  orderHash: string,
  failures: number
) {
  const normalized = hex(orderHash, 32);
  if (!Number.isSafeInteger(failures) || failures < 1 || failures > 16)
    throw new Error("Invalid OpenSea retry count.");
  const base = Math.min(300000, 30000 * 2 ** Math.min(failures - 1, 4));
  const jitter = Number.parseInt(normalized.slice(10, 18), 16) % 30001;
  return Math.min(300000, base + jitter);
}

export function openSeaProjectionAuditDelayMs(orderHash: string) {
  const normalized = hex(orderHash, 32);
  return (
    projectionAuditBaseMs +
    (Number.parseInt(normalized.slice(2, 10), 16) % projectionAuditJitterMs)
  );
}
