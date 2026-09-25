import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Hex, PublicClient } from "viem";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import { seaportReadAbi } from "@protopals/yunipals-market-core/seaport";

import { inspectBnbAdmission, type BnbAdmissionObservation } from "@/bnb/chain";
import { readIndexedBnbAsset } from "@/bnb/indexer";
import {
  BnbOrderError,
  bnbOrderSummary,
  checkBnbOrder,
  parseBnbOrderRequest,
  validateBnbPolicy,
  type BnbOrderRequest,
  type BnbPolicy
} from "@/bnb/orders";
import { findAcceptedBnbOrder } from "@/bnb/recovery";
import { assertBnbObservationCurrent } from "@/bnb/protocol";
import { enqueueJob } from "@/db/jobs";
import { transaction } from "@/db/pool";

const protocol = seaportDeployment.address.toLowerCase();

export class BnbAdmissionService {
  constructor(
    private readonly pool: Pool,
    private readonly client: PublicClient,
    private readonly policy: BnbPolicy,
    private readonly options: {
      confirmations: bigint;
      indexerMaxAgeMs: number;
      finality?: "confirmations" | "finalized";
      enabledAdmissionSides?: readonly ("listing" | "offer")[];
      authorize?: (
        input: BnbOrderRequest,
        summary: ReturnType<typeof checkBnbOrder>
      ) => void;
      now?: () => number;
    }
  ) {
    validateBnbPolicy(policy);
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private async findAccepted(
    db: Pick<PoolClient, "query">,
    hash: Hex,
    lifecycle?: number
  ) {
    return findAcceptedBnbOrder(db, hash, this.now(), lifecycle);
  }

  async accepted(hash: Hex) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
      throw new BnbOrderError("invalid_order_hash", 400);
    const result = await this.findAccepted(this.pool, hash);
    if (!result) throw new BnbOrderError("order_not_found", 404);
    return result;
  }

  private async lockScope(
    db: PoolClient,
    input: BnbOrderRequest,
    side: "listing" | "offer"
  ) {
    const scope = `bnb:${input.asset.contractAddress.toLowerCase()}:${input.asset.tokenId}:${input.order.offerer.toLowerCase()}:${side}`;
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      scope
    ]);
  }

  private async checkHistory(
    db: PoolClient,
    input: BnbOrderRequest,
    side: "listing" | "offer",
    observed: BnbAdmissionObservation
  ) {
    // Do not trust stale terminal labels: a reorg can undo a cancellation/fill.
    // Larger histories fail closed until background reconciliation can prove them.
    const history = await db.query<{ order_hash: Hex }>(
      `SELECT order_hash FROM yunipals_market.orders
      WHERE chain_id=56 AND protocol_address=$1 AND contract_address=$2 AND token_id=$3
        AND maker=$4 AND side=$5 AND publication_state='accepted' AND order_hash<>$6
        AND end_time>$7 AND counter=$8 ORDER BY order_hash LIMIT 101`,
      [
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
      throw new BnbOrderError("order_history_requires_reconciliation", 503);
    // Keep RPC concurrency bounded and all observations on the same block.
    for (let start = 0; start < history.rows.length; start += 8) {
      const statuses = await Promise.all(
        history.rows.slice(start, start + 8).map((row) =>
          this.client.readContract({
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
        throw new BnbOrderError("outstanding_order_requires_cancellation");
    }
  }

  private async finishObservation(observed: BnbAdmissionObservation) {
    await assertBnbObservationCurrent(this.client, observed, () => this.now());
  }

  async prepare(value: unknown) {
    const input = parseBnbOrderRequest(value);
    const summary = checkBnbOrder(input, this.policy);
    if (
      this.options.enabledAdmissionSides &&
      !this.options.enabledAdmissionSides.includes(summary.side)
    )
      throw new BnbOrderError("market_unavailable", 503);
    this.options.authorize?.(input, summary);
    const indexed = await readIndexedBnbAsset(this.pool, input.asset);
    const observed = await inspectBnbAdmission(
      this.client,
      input,
      summary,
      indexed,
      this.options
    );
    return transaction(this.pool, async (db) => {
      await this.lockScope(db, input, summary.side);
      await this.checkHistory(db, input, summary.side, observed);
      // Maker addresses are public, so an unauthenticated preparation must not
      // consume a maker-specific quota that another caller can exhaust for them.
      // Apply caller/global admission limits at the HTTP boundary before wiring it.
      await this.finishObservation(observed);
      const existing = await db.query<{ id: string; expires_at: Date }>(
        `SELECT id,expires_at FROM yunipals_market.preparation WHERE chain_id=56 AND protocol_address=$1
        AND order_hash=$2 AND lifecycle=$3 AND policy_version=$4 AND components=$5::jsonb
        AND expires_at>clock_timestamp()+interval '10 seconds' ORDER BY expires_at DESC LIMIT 1`,
        [
          protocol,
          input.hash.toLowerCase(),
          input.lifecycle,
          this.policy.version,
          JSON.stringify(input.wire)
        ]
      );
      if (existing.rows[0])
        return this.preparedResponse(input, existing.rows[0]);
      // Leave clock/transport margin within the client's 120-second maximum,
      // which is measured from its latest observed chain timestamp.
      const result = await db.query<{ id: string; expires_at: Date }>(
        `INSERT INTO yunipals_market.preparation
        (id,chain_id,protocol_address,order_hash,contract_address,token_id,lifecycle,maker,policy_version,components,expires_at)
        VALUES ($1,56,$2,$3,$4,$5,$6,$7,$8,$9,LEAST(clock_timestamp()+interval '60 seconds',to_timestamp($10)))
        RETURNING id,expires_at`,
        [
          randomUUID(),
          protocol,
          input.hash.toLowerCase(),
          input.asset.contractAddress.toLowerCase(),
          input.asset.tokenId,
          input.lifecycle,
          input.order.offerer.toLowerCase(),
          this.policy.version,
          JSON.stringify(input.wire),
          Number(input.order.endTime)
        ]
      );
      return this.preparedResponse(input, result.rows[0]!);
    });
  }

  private preparedResponse(
    input: BnbOrderRequest,
    prepared: { id: string; expires_at: Date }
  ) {
    return {
      schemaVersion: 1 as const,
      source: "yunipals" as const,
      id: prepared.id,
      asset: input.asset,
      lifecycle: input.lifecycle,
      orderHash: input.hash,
      expiresAt: Math.floor(prepared.expires_at.getTime() / 1000).toString(),
      order: input.wire
    };
  }

  async submit(value: unknown) {
    const input = parseBnbOrderRequest(value, true);
    // Acceptance survives expiry, fee changes, hidden/burned assets and RPC failure.
    const existing = await this.findAccepted(
      this.pool,
      input.hash,
      input.lifecycle
    );
    if (existing) {
      if (existing.order.asset.tokenId !== input.asset.tokenId)
        throw new BnbOrderError("order_asset_mismatch", 400);
      return existing;
    }
    const summary = checkBnbOrder(input, this.policy);
    if (
      this.options.enabledAdmissionSides &&
      !this.options.enabledAdmissionSides.includes(summary.side)
    )
      throw new BnbOrderError("market_unavailable", 503);
    this.options.authorize?.(input, summary);
    const indexed = await readIndexedBnbAsset(this.pool, input.asset);
    const observed = await inspectBnbAdmission(
      this.client,
      input,
      summary,
      indexed,
      this.options
    );
    return transaction(this.pool, async (db) => {
      await this.lockScope(db, input, summary.side);
      const accepted = await this.findAccepted(db, input.hash, input.lifecycle);
      if (accepted) return accepted;
      const prepared = await db.query<{
        policy_version: string;
        matches: boolean;
      }>(
        `SELECT policy_version,
        (chain_id=56 AND protocol_address=$2 AND order_hash=$3 AND contract_address=$4 AND token_id=$5
          AND lifecycle=$6 AND maker=$7 AND components=$8::jsonb) AS matches
        FROM yunipals_market.preparation WHERE id=$1 FOR UPDATE`,
        [
          input.preparationId,
          protocol,
          input.hash.toLowerCase(),
          input.asset.contractAddress.toLowerCase(),
          input.asset.tokenId,
          input.lifecycle,
          input.order.offerer.toLowerCase(),
          JSON.stringify(input.wire)
        ]
      );
      if (!prepared.rows[0]?.matches)
        throw new BnbOrderError("preparation_mismatch");
      if (prepared.rows[0].policy_version !== this.policy.version)
        throw new BnbOrderError("preparation_policy_changed");
      // An expired preparation does not revoke an already issued signature.
      await this.checkHistory(db, input, summary.side, observed);
      await this.finishObservation(observed);
      const response = bnbOrderSummary(input, summary, "active");
      await db.query(
        `INSERT INTO yunipals_market.orders
        (chain_id,protocol_address,order_hash,contract_address,token_id,lifecycle,source,side,maker,currency,gross_amount,
          seller_proceeds,start_time,end_time,counter,components,signature,summary,policy_version,publication_state,
          accepted_at,state,state_observed_at,state_block_number,state_block_hash,admission_block_number,admission_block_hash)
        VALUES (56,$1,$2,$3,$4,$5,'yunipals',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'accepted',clock_timestamp(),
          'active',$18,$19,$20,$19,$20)`,
        [
          protocol,
          input.hash.toLowerCase(),
          input.asset.contractAddress.toLowerCase(),
          input.asset.tokenId,
          input.lifecycle,
          summary.side,
          summary.maker.toLowerCase(),
          summary.currency.toLowerCase(),
          summary.grossAmount.toString(),
          summary.sellerProceeds.toString(),
          input.order.startTime.toString(),
          input.order.endTime.toString(),
          input.order.counter.toString(),
          JSON.stringify(input.wire),
          input.signature,
          JSON.stringify(response),
          this.policy.version,
          new Date(observed.checkedAt),
          observed.number.toString(),
          observed.hash.toLowerCase()
        ]
      );
      // Fence a scan that started before this accepted order became visible.
      // Admission and a necessary replay request commit in the same transaction.
      await db.query(
        `UPDATE yunipals_market.checkpoint SET generation=generation+1,state='syncing',
          replay_from=CASE WHEN coverage_start_time>$2::numeric THEN 0
            WHEN block_number IS NULL OR block_number>=$1::numeric
            THEN LEAST(replay_from,$1::numeric) ELSE replay_from END
        WHERE source='chain' AND chain_id=56 AND name='bnb-sales'`,
        [observed.number.toString(), input.order.startTime.toString()]
      );
      await enqueueJob(db, {
        kind: "bnb_order_reconcile",
        key: input.hash.toLowerCase(),
        payload: {
          chainId: 56,
          protocolAddress: protocol,
          orderHash: input.hash.toLowerCase()
        }
      });
      return {
        schemaVersion: 1 as const,
        persisted: true as const,
        order: response
      };
    });
  }
}
