import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Pool } from "pg";
import {
  erc20Abi,
  erc721Abi,
  getAddress,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import {
  buildOpenSeaFulfillment,
  openSeaAuthorizationExpiry,
  type OpenSeaTrade
} from "@protopals/yunipals-market-core/openseaFulfillment";
import type { MarketOrder } from "@protopals/yunipals-market-core/marketOrder";
import {
  isOpenSeaChain,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";
import {
  seaportFulfillmentOrder,
  seaportWriteAbi
} from "@protopals/yunipals-market-core/seaport";
import {
  address,
  hex,
  integer,
  record
} from "@protopals/yunipals-market-core/validation";
import { loadOpenSeaFulfillmentCandidate } from "@/opensea/fulfillmentCandidate";
import { retainOpenSeaMakerSignature } from "@/opensea/makerSignature";
import {
  assertOpenSeaObservationCurrent,
  inspectOpenSeaAdmission
} from "@/opensea/chain";
import { readIndexedOpenSeaAsset } from "@/opensea/indexer";
import {
  checkDiscoveredOpenSeaPolicy,
  type DiscoveredObservationOptions
} from "@/opensea/discoveredReconciliation";
import {
  checkOpenSeaOrder,
  OpenSeaOrderError,
  parseOpenSeaOrderRequest
} from "@/opensea/orders";
import {
  OpenSeaPolicyError,
  type OpenSeaPolicyResolver
} from "@/opensea/policy";
import { OpenSeaError, type OpenSeaClient } from "@/opensea/client";

export class OpenSeaFulfillmentService {
  constructor(
    private readonly pool: Pool,
    private readonly clients: Partial<Record<OpenSeaChain, PublicClient>>,
    private readonly policies: Pick<OpenSeaPolicyResolver, "resolve">,
    private readonly provider: Pick<OpenSeaClient, "fulfillment">,
    private readonly options: DiscoveredObservationOptions & {
      onTiming?: (stage: string, milliseconds: number) => void;
      authorize?: (
        summary: MarketOrder,
        actor: Address,
        policyVersion: string
      ) => void;
    }
  ) {
    if (
      !Number.isSafeInteger(options.providerMaxAgeMs) ||
      options.providerMaxAgeMs < 1000 ||
      options.providerMaxAgeMs > 600000
    )
      throw new Error("Invalid fulfillment freshness settings.");
    if (options.enabledFulfillmentSides)
      for (const [chain, sides] of Object.entries(
        options.enabledFulfillmentSides
      )) {
        if (
          !isOpenSeaChain(chain as OpenSeaChain) ||
          !sides ||
          sides.length < 1 ||
          new Set(sides).size !== sides.length ||
          sides.some((side) => side !== "listing" && side !== "offer")
        )
          throw new Error("Invalid OpenSea fulfillment capability scope.");
      }
  }
  private async timed<T>(stage: string, task: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await task();
    } finally {
      this.options.onTiming?.(stage, Math.round(performance.now() - started));
    }
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private timestamp() {
    return BigInt(Math.floor(this.now() / 1000));
  }
  private async inspect(chain: OpenSeaChain, hash: Hex, value: unknown) {
    let actor: Address, lifecycle: number;
    try {
      const data = record(value);
      if (
        Object.keys(data).length !== 2 ||
        !Object.hasOwn(data, "actor") ||
        !Object.hasOwn(data, "lifecycle")
      )
        throw new Error();
      actor = address(data.actor);
      lifecycle = integer(data.lifecycle, 2147483647);
      if (actor === zeroAddress || !isOpenSeaChain(chain)) throw new Error();
      hash = hex(hash, 32);
    } catch {
      throw new OpenSeaOrderError("invalid_fulfillment_request", 400);
    }
    const client = this.clients[chain];
    if (!client) throw new OpenSeaOrderError("market_unavailable", 503);
    const candidate = await loadOpenSeaFulfillmentCandidate(
      this.pool,
      chain,
      hash
    );
    if (candidate.summary.lifecycle !== lifecycle)
      throw new OpenSeaOrderError("asset_changed");
    if (getAddress(candidate.summary.maker) === actor)
      throw new OpenSeaOrderError("self_trade_rejected", 400);
    const sourceCurrent = (source = candidate) => {
      if (
        source.providerSeenAt !== null &&
        (this.now() - source.providerSeenAt > this.options.providerMaxAgeMs ||
          source.providerSeenAt > this.now() + 30000)
      )
        throw new OpenSeaOrderError("provider_observation_stale", 503);
    };
    sourceCurrent();
    let policy;
    try {
      policy = (await this.policies.resolve(chain, true)).policy;
    } catch (error) {
      throw new OpenSeaOrderError(
        error instanceof OpenSeaError || error instanceof OpenSeaPolicyError
          ? error.code
          : "provider_policy_unavailable",
        503
      );
    }
    const input = parseOpenSeaOrderRequest({
      asset: candidate.summary.asset,
      lifecycle,
      order: candidate.wire,
      policyVersion: candidate.policyVersion ?? policy.version
    });
    const summary = { ...candidate.summary, status: "active" as const };
    const enabledSides = this.options.enabledFulfillmentSides?.[chain];
    if (
      this.options.enabledFulfillmentSides &&
      !enabledSides?.includes(summary.side)
    )
      throw new OpenSeaOrderError("market_unavailable", 503);
    this.options.authorize?.(summary, actor, input.policyVersion);
    const policyCurrent = () =>
      candidate.origin === "retained"
        ? checkOpenSeaOrder(input, policy, this.timestamp())
        : checkDiscoveredOpenSeaPolicy(
            summary,
            input.order,
            policy,
            this.timestamp()
          );
    policyCurrent();
    const indexed = await readIndexedOpenSeaAsset(this.pool, input.asset);
    if (
      indexed.lifecycle !== lifecycle ||
      (candidate.mintHash &&
        candidate.mintHash !== indexed.mint.transactionHash)
    )
      throw new OpenSeaOrderError("asset_changed");
    if (summary.side === "offer" && indexed.owner !== actor)
      throw new OpenSeaOrderError("fulfiller_ownership_mismatch");
    // Validate durable order/ownership evidence before fetching the short-lived
    // actor authorization. The final canonical check still fences this same block.
    const observed = await this.timed("chain_validation", () =>
      inspectOpenSeaAdmission(client, input, indexed, this.options)
    );
    // Provider data is a private immutable snapshot, never a wallet template.
    let fulfillment: unknown;
    try {
      fulfillment = structuredClone(
        await this.timed("provider_authorization", () =>
          this.provider.fulfillment(summary, actor)
        )
      );
    } catch (error) {
      throw new OpenSeaOrderError(
        error instanceof OpenSeaError
          ? error.code
          : "provider_authorization_unavailable",
        503
      );
    }
    const nowSeconds = this.timestamp();
    let expiresAt = [
      nowSeconds + 30n,
      input.order.endTime,
      policy.expiresAt
    ].reduce((a, b) => (a < b ? a : b));
    try {
      if (input.order.orderType >= 2) {
        const transaction = record(
          record(record(fulfillment).fulfillment_data).transaction
        );
        const authorization = record(
          record(transaction.input_data).advancedOrder
        );
        const expiry = openSeaAuthorizationExpiry(
          authorization.extraData,
          actor,
          nowSeconds
        );
        if (expiry < expiresAt) expiresAt = expiry;
      }
    } catch {
      throw new OpenSeaOrderError("provider_authorization_mismatch", 503);
    }
    const quote = {
      schemaVersion: 1 as const,
      source: "opensea" as const,
      id: randomUUID(),
      asset: input.asset,
      lifecycle,
      actor,
      orderHash: hash,
      expiresAt: expiresAt.toString(),
      fulfillment
    };
    let trade: OpenSeaTrade;
    try {
      trade = buildOpenSeaFulfillment(quote, summary, actor, nowSeconds);
    } catch {
      throw new OpenSeaOrderError("provider_fulfillment_mismatch", 503);
    }
    // Maker validity is checked through Seaport below, allowing its native EOA,
    // contract-wallet, bulk-signature and already-validated-order semantics.

    try {
      const result = await client.simulateContract({
        address: seaportDeployment.address,
        abi: seaportWriteAbi,
        functionName: "validate",
        args: [[seaportFulfillmentOrder(input.order, trade.signature)]],
        account: actor,
        blockNumber: observed.number
      });
      if (result.result !== true) throw new Error();
    } catch {
      throw new OpenSeaOrderError("invalid_maker_signature", 409);
    }
    const finish = async () => {
      const current = await readIndexedOpenSeaAsset(this.pool, input.asset);
      const { checkpoint: before, ...priorAsset } = indexed;
      const { checkpoint: after, ...currentAsset } = current;
      if (
        !isDeepStrictEqual(priorAsset, currentAsset) ||
        after.number < before.number ||
        after.heartbeatAt < before.heartbeatAt
      )
        throw new OpenSeaOrderError("asset_still_syncing", 503);
      const latest = await loadOpenSeaFulfillmentCandidate(
        this.pool,
        chain,
        hash
      );
      if (
        candidate.origin !== latest.origin ||
        !isDeepStrictEqual(candidate.provenance, latest.provenance)
      )
        throw new OpenSeaOrderError("order_changed_during_fulfillment", 503);
      sourceCurrent();
      sourceCurrent(latest);
      policyCurrent();
      if (this.timestamp() >= expiresAt)
        throw new OpenSeaOrderError("provider_authorization_expired", 503);

      await this.timed("signature_retention", () =>
        retainOpenSeaMakerSignature(
          this.pool,
          candidate,
          actor,
          trade.signature,
          observed
        )
      );
      // Retention stores historical evidence without locking collector rows.
      // A source change during that commit must still invalidate this response.
      const afterRetention = await loadOpenSeaFulfillmentCandidate(
        this.pool,
        chain,
        hash
      );
      if (
        candidate.origin !== afterRetention.origin ||
        !isDeepStrictEqual(candidate.provenance, afterRetention.provenance)
      )
        throw new OpenSeaOrderError("order_changed_during_fulfillment", 503);
      sourceCurrent(afterRetention);
      // A database lock wait cannot extend a quote or its chain observation.
      if (this.timestamp() >= expiresAt)
        throw new OpenSeaOrderError("provider_authorization_expired", 503);
      await this.timed("final_chain_check", () =>
        assertOpenSeaObservationCurrent(
          client,
          observed,
          () => this.now(),
          this.options.observationMaxAgeMs
        )
      );
    };
    return { quote, trade, client, observed, finish };
  }

  async preflight(chain: OpenSeaChain, hash: Hex, value: unknown) {
    const checked = await this.inspect(chain, hash, value);
    await checked.finish();
    // No actor approval or funding is presumed. This response only supports
    // prerequisite discovery; the UI requests a new simulated quote afterward.
    return {
      ...checked.quote,
      purpose: "preflight" as const,
      simulated: false as const
    };
  }

  async prepare(chain: OpenSeaChain, hash: Hex, value: unknown) {
    return this.timed("prepare_total", async () => {
      const result = await this.quote(chain, hash, value, true);
      // Never hand the browser a quote already consumed by server validation.
      if (BigInt(result.expiresAt) - this.timestamp() < 20n)
        throw new OpenSeaOrderError("trade_preparation_too_slow", 503);
      return { ...result, purpose: "prepare" as const };
    });
  }

  async quote(
    chain: OpenSeaChain,
    hash: Hex,
    value: unknown,
    allowPrerequisites = false
  ) {
    const checked = await this.inspect(chain, hash, value);
    const { client, trade, observed } = checked;
    const { intent } = trade;
    try {
      if (
        intent.value > 0n &&
        (await client.getBalance({
          address: intent.account,
          blockNumber: observed.number
        })) < intent.value
      )
        throw new OpenSeaOrderError("buyer_funding_required");
      for (const approval of trade.approvals) {
        if (approval.kind === "nft") {
          const [operator, approved] = await Promise.all([
            client.readContract({
              address: approval.token,
              abi: erc721Abi,
              functionName: "isApprovedForAll",
              args: [intent.account, approval.spender],
              blockNumber: observed.number
            }),
            client.readContract({
              address: approval.token,
              abi: erc721Abi,
              functionName: "getApproved",
              args: [BigInt(approval.tokenId)],
              blockNumber: observed.number
            })
          ]);
          if (
            !operator &&
            getAddress(approved) !== getAddress(approval.spender)
          )
            throw new OpenSeaOrderError("nft_approval_required");
        } else {
          const [balance, allowance] = await Promise.all([
            client.readContract({
              address: approval.token,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [intent.account],
              blockNumber: observed.number
            }),
            client.readContract({
              address: approval.token,
              abi: erc20Abi,
              functionName: "allowance",
              args: [intent.account, approval.spender],
              blockNumber: observed.number
            })
          ]);
          if (!approval.fundedByOffer && balance < approval.amount)
            throw new OpenSeaOrderError("buyer_funding_required");
          if (allowance < approval.amount)
            throw new OpenSeaOrderError("currency_approval_required");
        }
      }
    } catch (error) {
      if (
        !allowPrerequisites ||
        !(error instanceof OpenSeaOrderError) ||
        ![
          "buyer_funding_required",
          "nft_approval_required",
          "currency_approval_required"
        ].includes(error.code)
      )
        throw error;
      await checked.finish();
      return {
        ...checked.quote,
        purpose: "preflight" as const,
        simulated: false as const
      };
    }
    try {
      const response = await this.timed("settlement_simulation", () =>
        client.call({
          account: intent.account,
          to: intent.to,
          data: intent.data,
          value: intent.value,
          blockNumber: observed.number
        })
      );
      if (response.data !== `0x${"0".repeat(63)}1`) throw new Error();
    } catch {
      throw new OpenSeaOrderError("fulfillment_simulation_failed", 409);
    }
    await checked.finish();
    return {
      ...checked.quote,
      purpose: "fulfillment" as const,
      simulated: true as const
    };
  }
}
