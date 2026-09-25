import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import type { Hex, PublicClient } from "viem";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";
import type { OpenSeaOrderPolicy } from "@protopals/yunipals-market-core/openseaOrderPolicy";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import { seaportReadAbi } from "@protopals/yunipals-market-core/seaport";

import { transaction } from "@/db/pool";
import {
  assertOpenSeaObservationCurrent,
  inspectOpenSeaAdmission,
  readOpenSeaHead,
  type OpenSeaObservation,
  type OpenSeaObservationOptions
} from "@/opensea/chain";
import {
  readIndexedOpenSeaAsset,
  type IndexedOpenSeaAsset
} from "@/opensea/indexer";
import {
  checkOpenSeaOrder,
  OpenSeaOrderError,
  parseOpenSeaOrderRequest,
  snapshotOpenSeaPublication,
  type OpenSeaPublication,
  type OpenSeaOrderRequest
} from "@/opensea/orders";
import {
  readRetainedOpenSeaCandidate,
  retainOpenSeaCandidateInTransaction
} from "@/opensea/outbox";
import { retainedOpenSeaResponse } from "@/opensea/recovery";
import type { OpenSeaPolicyResolver } from "@/opensea/policy";

const protocol = seaportDeployment.address.toLowerCase();

/** Admission retains a verified signature; only the outbox can establish provider acceptance. */
export class OpenSeaAdmissionService {
  constructor(
    private readonly pool: Pool,
    private readonly clients: Partial<Record<OpenSeaChain, PublicClient>>,
    private readonly policies: Pick<OpenSeaPolicyResolver, "resolve">,
    private readonly options: OpenSeaObservationOptions & {
      authorize?: (
        input: OpenSeaOrderRequest,
        summary: ReturnType<typeof checkOpenSeaOrder>
      ) => void;
    }
  ) {}

  private now = () => this.options.now?.() ?? Date.now();

  private client(chain: OpenSeaChain) {
    const client = this.clients[chain];
    if (!client) throw new OpenSeaOrderError("market_unavailable", 503);
    return client;
  }

  async policy(chain: OpenSeaChain) {
    this.client(chain);
    return (await this.policies.resolve(chain)).wire;
  }

  private async retained(
    db: Pick<PoolClient, "query">,
    input: OpenSeaOrderRequest
  ) {
    const stored = await readRetainedOpenSeaCandidate(
      db,
      input.asset.chainId,
      input.hash
    );
    if (!stored) return null;
    if (
      stored.publication.summary.lifecycle !== input.lifecycle ||
      stored.publication.summary.asset.tokenId !== input.asset.tokenId ||
      !isDeepStrictEqual(stored.publication.order, input.wire)
    )
      throw new OpenSeaOrderError("order_identity_mismatch");
    return retainedOpenSeaResponse(stored);
  }

  private async lockScope(
    db: PoolClient,
    input: OpenSeaOrderRequest,
    side: string
  ) {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `opensea:${input.asset.chainId}:${input.asset.contractAddress.toLowerCase()}:${input.asset.tokenId}:${input.order.offerer.toLowerCase()}:${side}`
    ]);
  }

  private async checkHistory(
    db: PoolClient,
    client: PublicClient,
    input: OpenSeaOrderRequest,
    side: string,
    observed: OpenSeaObservation
  ) {
    // Pending/uncertain/rejected signatures remain executable outside our API.
    // A lifecycle change or stale terminal label does not revoke them either.
    const history = await db.query<{ order_hash: Hex }>(
      `SELECT order_hash FROM yunipals_market.orders WHERE chain_id=$1 AND protocol_address=$2
      AND contract_address=$3 AND token_id=$4 AND maker=$5 AND side=$6 AND signature IS NOT NULL
      AND order_hash<>$7 AND end_time>$8 AND counter=$9 ORDER BY order_hash LIMIT 101`,
      [
        input.asset.chainId,
        protocol,
        input.asset.contractAddress.toLowerCase(),
        input.asset.tokenId,
        input.order.offerer.toLowerCase(),
        side,
        input.hash.toLowerCase(),
        observed.timestamp.toString(),
        input.order.counter.toString()
      ]
    );
    if (history.rows.length > 100)
      throw new OpenSeaOrderError("order_history_requires_reconciliation", 503);
    for (let start = 0; start < history.rows.length; start += 8) {
      const statuses = await Promise.all(
        history.rows.slice(start, start + 8).map((row) =>
          client.readContract({
            address: seaportDeployment.address,
            abi: seaportReadAbi,
            functionName: "getOrderStatus",
            args: [row.order_hash],
            blockNumber: observed.number
          })
        )
      );
      if (
        statuses.some(
          (status) => !status[1] && !(status[3] > 0n && status[2] >= status[3])
        )
      )
        throw new OpenSeaOrderError("outstanding_order_requires_cancellation");
    }
  }

  private async inspect(input: OpenSeaOrderRequest) {
    const client = this.client(input.asset.chain);
    // Resolve policy before starting the short chain observation window.
    const { policy } = await this.policies.resolve(input.asset.chain, true);
    const [indexed, head] = await Promise.all([
      readIndexedOpenSeaAsset(this.pool, input.asset),
      readOpenSeaHead(
        client,
        input.asset.chain,
        this.now,
        this.options.finality
      )
    ]);
    const summary = checkOpenSeaOrder(
      input,
      policy,
      BigInt(Math.max(Math.floor(this.now() / 1000), Number(head.timestamp)))
    );
    const enabledSides =
      this.options.enabledAdmissionSides?.[input.asset.chain];
    if (
      this.options.enabledAdmissionSides &&
      !enabledSides?.includes(summary.side)
    )
      throw new OpenSeaOrderError("market_unavailable", 503);
    this.options.authorize?.(input, summary);
    const observed = await inspectOpenSeaAdmission(
      client,
      input,
      indexed,
      this.options,
      head
    );
    return { client, indexed, observed, summary, policy };
  }

  private async finish(
    db: PoolClient,
    input: OpenSeaOrderRequest,
    before: IndexedOpenSeaAsset,
    client: PublicClient,
    observed: OpenSeaObservation,
    policy: OpenSeaOrderPolicy
  ) {
    const current = await readIndexedOpenSeaAsset(db, input.asset);
    // An advancing cursor is normal. Any change to the asset's evidence requires
    // a fresh observation, including visibility changes tied to a transfer.
    const { checkpoint: _before, ...previousAsset } = before;
    const { checkpoint: _after, ...currentAsset } = current;
    if (
      !isDeepStrictEqual(previousAsset, currentAsset) ||
      current.checkpoint.number < before.checkpoint.number ||
      current.checkpoint.heartbeatAt < before.checkpoint.heartbeatAt
    )
      throw new OpenSeaOrderError("asset_still_syncing", 503);
    await assertOpenSeaObservationCurrent(client, observed, this.now);
    checkOpenSeaOrder(
      input,
      policy,
      BigInt(
        Math.max(Math.floor(this.now() / 1000), Number(observed.timestamp))
      )
    );
  }

  async prepare(value: unknown) {
    const input = parseOpenSeaOrderRequest(value);
    const { client, indexed, observed, summary, policy } =
      await this.inspect(input);
    return transaction(this.pool, async (db) => {
      await this.lockScope(db, input, summary.side);
      await this.checkHistory(db, client, input, summary.side, observed);
      await this.finish(db, input, indexed, client, observed, policy);
      const existing = await db.query<{ id: string; expires_at: Date }>(
        `SELECT id,expires_at FROM yunipals_market.preparation WHERE chain_id=$1 AND protocol_address=$2
        AND order_hash=$3 AND lifecycle=$4 AND policy_version=$5 AND components=$6::jsonb
        AND expires_at>clock_timestamp()+interval '10 seconds' ORDER BY expires_at DESC LIMIT 1`,
        [
          input.asset.chainId,
          protocol,
          input.hash.toLowerCase(),
          input.lifecycle,
          input.policyVersion,
          JSON.stringify(input.wire)
        ]
      );
      const prepared =
        existing.rows[0] ??
        (
          await db.query<{ id: string; expires_at: Date }>(
            `INSERT INTO yunipals_market.preparation
        (id,chain_id,protocol_address,order_hash,contract_address,token_id,lifecycle,maker,policy_version,components,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,LEAST(clock_timestamp()+interval '60 seconds',to_timestamp($11))) RETURNING id,expires_at`,
            [
              randomUUID(),
              input.asset.chainId,
              protocol,
              input.hash.toLowerCase(),
              input.asset.contractAddress.toLowerCase(),
              input.asset.tokenId,
              input.lifecycle,
              input.order.offerer.toLowerCase(),
              input.policyVersion,
              JSON.stringify(input.wire),
              Number(input.order.endTime)
            ]
          )
        ).rows[0]!;
      return {
        schemaVersion: 1 as const,
        source: "opensea" as const,
        id: prepared.id,
        asset: input.asset,
        lifecycle: input.lifecycle,
        orderHash: input.hash,
        policyVersion: input.policyVersion,
        expiresAt: Math.floor(prepared.expires_at.getTime() / 1000).toString(),
        order: input.wire
      };
    });
  }

  async submit(value: unknown) {
    const input = parseOpenSeaOrderRequest(value, true);
    // Recovery of an already retained signature survives provider/RPC outages.
    const retained = await this.retained(this.pool, input);
    if (retained) return retained;
    const { client, indexed, observed, summary, policy } =
      await this.inspect(input);
    return transaction(this.pool, async (db) => {
      await this.lockScope(db, input, summary.side);
      const existing = await this.retained(db, input);
      if (existing) return existing;
      const prepared = await db.query<{ matches: boolean }>(
        `SELECT (chain_id=$2 AND protocol_address=$3 AND order_hash=$4 AND contract_address=$5 AND token_id=$6
        AND lifecycle=$7 AND maker=$8 AND policy_version=$9 AND components=$10::jsonb) AS matches
        FROM yunipals_market.preparation WHERE id=$1 FOR UPDATE`,
        [
          input.preparationId,
          input.asset.chainId,
          protocol,
          input.hash.toLowerCase(),
          input.asset.contractAddress.toLowerCase(),
          input.asset.tokenId,
          input.lifecycle,
          input.order.offerer.toLowerCase(),
          input.policyVersion,
          JSON.stringify(input.wire)
        ]
      );
      if (!prepared.rows[0]?.matches)
        throw new OpenSeaOrderError("preparation_mismatch");
      // Preparation expiry cannot revoke an issued signature; all economic and
      // chain checks above still apply to its first durable admission.
      await this.checkHistory(db, client, input, summary.side, observed);
      await this.finish(db, input, indexed, client, observed, policy);
      await retainOpenSeaCandidateInTransaction(db, {
        publication: {
          order: input.wire,
          signature: input.signature!,
          summary
        },
        policyVersion: input.policyVersion,
        admissionBlock: {
          number: observed.number.toString(),
          hash: observed.hash
        }
      });
      return (await this.retained(db, input))!;
    });
  }

  /** Revalidate the retained signature immediately before a worker's first POST.
   * This is a correctness gate, not permission to publish on a live provider.
   */
  async validateRetainedForSend(value: OpenSeaPublication) {
    const publication = snapshotOpenSeaPublication(value);
    const stored = await readRetainedOpenSeaCandidate(
      this.pool,
      publication.summary.asset.chainId,
      publication.summary.orderHash
    );
    if (
      !stored ||
      !["pending", "indeterminate"].includes(stored.state) ||
      stored.publication.signature !== publication.signature ||
      !isDeepStrictEqual(stored.publication.order, publication.order)
    )
      throw new OpenSeaOrderError("retained_order_mismatch");
    const input = parseOpenSeaOrderRequest({
      asset: publication.summary.asset,
      lifecycle: publication.summary.lifecycle,
      order: publication.order,
      policyVersion: stored.policyVersion
    });
    input.signature = publication.signature;
    const { client, indexed, observed, summary, policy } =
      await this.inspect(input);
    await transaction(this.pool, async (db) => {
      await this.lockScope(db, input, summary.side);
      await this.checkHistory(db, client, input, summary.side, observed);
      await this.finish(db, input, indexed, client, observed, policy);
    });
  }
}
