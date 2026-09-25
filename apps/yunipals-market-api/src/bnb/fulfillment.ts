import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  erc721Abi,
  getAddress,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import {
  seaportBasicOfferParameters,
  seaportFulfillmentOrder,
  seaportWriteAbi
} from "@protopals/yunipals-market-core/seaport";
import {
  address,
  integer,
  record
} from "@protopals/yunipals-market-core/validation";

import { inspectBnbAdmission, type BnbAdmissionObservation } from "@/bnb/chain";
import { readIndexedBnbAsset } from "@/bnb/indexer";
import {
  BnbOrderError,
  checkBnbOrder,
  validateBnbPolicy,
  type BnbPolicy
} from "@/bnb/orders";
import { loadBnbTradeOrder } from "@/bnb/storedOrder";
import { assertBnbObservationCurrent } from "@/bnb/protocol";

export class BnbFulfillmentService {
  constructor(
    private readonly pool: Pool,
    private readonly client: PublicClient,
    private readonly policy: BnbPolicy,
    private readonly options: {
      confirmations: bigint;
      indexerMaxAgeMs: number;
      finality?: "confirmations" | "finalized";
      now?: () => number;
      enabledFulfillmentSides?: readonly ("listing" | "offer")[];
      authorize?: (
        input: Awaited<ReturnType<typeof loadBnbTradeOrder>>,
        summary: ReturnType<typeof checkBnbOrder>,
        actor: Address
      ) => void;
    }
  ) {
    validateBnbPolicy(policy);
    if (
      options.enabledFulfillmentSides &&
      (options.enabledFulfillmentSides.length < 1 ||
        new Set(options.enabledFulfillmentSides).size !==
          options.enabledFulfillmentSides.length ||
        options.enabledFulfillmentSides.some(
          (side) => side !== "listing" && side !== "offer"
        ))
    )
      throw new Error("Invalid BNB fulfillment capability scope.");
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private async inspect(hash: Hex, value: unknown) {
    let actor, lifecycle;
    try {
      const data = record(value);
      if (
        Object.keys(data).length !== 2 ||
        !("actor" in data) ||
        !("lifecycle" in data)
      )
        throw new Error();
      actor = address(data.actor);
      lifecycle = integer(data.lifecycle, 2147483647);
      if (actor === zeroAddress) throw new Error();
    } catch {
      throw new BnbOrderError("invalid_fulfillment_request", 400);
    }
    const input = await loadBnbTradeOrder(this.pool, hash);
    if (input.lifecycle !== lifecycle) throw new BnbOrderError("asset_changed");
    const summary = checkBnbOrder(input, this.policy);
    if (
      this.options.enabledFulfillmentSides &&
      !this.options.enabledFulfillmentSides.includes(summary.side)
    )
      throw new BnbOrderError("market_unavailable", 503);
    this.options.authorize?.(input, summary, actor);
    if (getAddress(summary.maker) === actor)
      throw new BnbOrderError("self_trade_rejected", 400);
    const indexed = await readIndexedBnbAsset(this.pool, input.asset);
    if (summary.side === "offer" && indexed.owner !== actor)
      throw new BnbOrderError("fulfiller_ownership_mismatch");
    const observed = await inspectBnbAdmission(
      this.client,
      input,
      summary,
      indexed,
      { ...this.options, deferCurrentCheck: true }
    );
    let needsNftApproval = false;
    if (summary.side === "offer") {
      const [operator, approved] = await Promise.all([
        this.client.readContract({
          address: input.asset.contractAddress,
          abi: erc721Abi,
          functionName: "isApprovedForAll",
          args: [actor, seaportDeployment.address],
          blockNumber: observed.number
        }),
        this.client.readContract({
          address: input.asset.contractAddress,
          abi: erc721Abi,
          functionName: "getApproved",
          args: [summary.tokenId],
          blockNumber: observed.number
        })
      ]);
      needsNftApproval =
        !operator &&
        getAddress(approved) !== getAddress(seaportDeployment.address);
    } else if (
      (await this.client.getBalance({
        address: actor,
        blockNumber: observed.number
      })) < summary.grossAmount
    ) {
      throw new BnbOrderError("buyer_funding_required");
    }
    return { input, summary, actor, observed, needsNftApproval };
  }

  private expiry(endTime: bigint, seconds: number) {
    const now = BigInt(Math.floor(this.now() / 1000));
    const candidate = now + BigInt(seconds);
    if (endTime <= now) throw new BnbOrderError("order_not_active");
    return (endTime < candidate ? endTime : candidate).toString();
  }

  private async finish(observed: BnbAdmissionObservation) {
    await assertBnbObservationCurrent(this.client, observed, () => this.now());
  }

  async preflight(hash: Hex, value: unknown) {
    const checked = await this.inspect(hash, value);
    await this.finish(checked.observed);
    return {
      schemaVersion: 1 as const,
      source: "yunipals" as const,
      asset: checked.input.asset,
      lifecycle: checked.input.lifecycle,
      actor: checked.actor,
      protocolAddress: seaportDeployment.address,
      orderHash: checked.input.hash,
      expiresAt: this.expiry(checked.input.order.endTime, 30),
      needsNftApproval: checked.needsNftApproval
    };
  }

  async quote(hash: Hex, value: unknown) {
    const { input, summary, actor, observed, needsNftApproval } =
      await this.inspect(hash, value);
    if (needsNftApproval) throw new BnbOrderError("nft_approval_required");
    const simulation =
      summary.side === "listing"
        ? await this.client.simulateContract({
            address: seaportDeployment.address,
            abi: seaportWriteAbi,
            functionName: "fulfillOrder",
            args: [
              seaportFulfillmentOrder(input.order, input.signature),
              zeroHash
            ],
            account: actor,
            value: summary.grossAmount,
            blockNumber: observed.number
          })
        : await this.client.simulateContract({
            address: seaportDeployment.address,
            abi: seaportWriteAbi,
            functionName: "fulfillBasicOrder",
            args: [seaportBasicOfferParameters(input.order, input.signature)],
            account: actor,
            blockNumber: observed.number
          });
    if (simulation.result !== true)
      throw new BnbOrderError("fulfillment_rejected");
    await this.finish(observed);
    return {
      schemaVersion: 1 as const,
      source: "yunipals" as const,
      id: randomUUID(),
      asset: input.asset,
      lifecycle: input.lifecycle,
      actor,
      orderHash: input.hash,
      expiresAt: this.expiry(input.order.endTime, 60),
      order: input.wire,
      signature: input.signature
    };
  }
}
