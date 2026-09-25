import { createHash } from "node:crypto";
import { getAddress, zeroAddress } from "viem";
import { parseOpenSeaOrderPolicy } from "@protopals/yunipals-market-core/openseaOrderPolicy";
import {
  openSeaCurrency,
  openseaCurrencies,
  openseaSignedZone,
  isOpenSeaChain,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";
import { calculateOrderFees } from "@protopals/yunipals-market-core/orderPolicy";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import {
  address,
  array,
  boolean,
  integer,
  record,
  string
} from "@protopals/yunipals-market-core/validation";

import { OpenSeaError, type OpenSeaClient } from "@/opensea/client";

export class OpenSeaPolicyError extends Error {
  constructor(
    readonly code:
      | "provider_collection_mismatch"
      | "provider_policy_unsupported"
      | "provider_collection_disabled"
  ) {
    super(code);
    this.name = "OpenSeaPolicyError";
  }
}

function slug(value: unknown) {
  const result = string(value, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(result))
    throw new Error("Invalid collection slug.");
  return result;
}

export function resolveOpenSeaContract(value: unknown, chain: OpenSeaChain) {
  try {
    const data = record(value);
    if (
      !isOpenSeaChain(chain) ||
      data.chain !== chain ||
      address(data.address) !==
        getAddress(marketplaceChains[chain].contractAddress) ||
      data.contract_standard !== "erc721"
    )
      throw new Error();
    return slug(data.collection);
  } catch {
    throw new OpenSeaPolicyError("provider_collection_mismatch");
  }
}

// OpenSea fees are percentages: 2.5 means 250 bps. Match the official SDK's
// decimal shift/half-up rounding without multiplying binary floating values.
function basisPoints(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value >= 100
  )
    throw new Error("Invalid provider fee.");
  let text = String(value);
  if (/[eE]/.test(text))
    text = value.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  const [whole, fraction = ""] = text.split(".");
  const digits = fraction.padEnd(2, "0");
  return Number(
    BigInt(`${whole}${digits.slice(0, 2)}`) +
      (Number(digits[2] ?? "0") >= 5 ? 1n : 0n)
  );
}

function payment(value: unknown, chain: OpenSeaChain) {
  const token = record(value);
  const currency = openSeaCurrency(chain, address(token.address));
  if (
    token.chain !== chain ||
    integer(token.decimals, 36) !== currency.decimals ||
    token.symbol !== currency.symbol
  )
    throw new Error("Provider currency metadata mismatch.");
  return currency.address;
}

export function resolveOpenSeaCollectionPolicy(
  value: unknown,
  input: {
    chain: OpenSeaChain;
    collectionSlug: string;
    observedAt: number;
    maxDurationSeconds: number;
    validForSeconds?: number;
  }
) {
  try {
    if (
      !isOpenSeaChain(input.chain) ||
      !Number.isSafeInteger(input.observedAt) ||
      input.observedAt < 0 ||
      !Number.isSafeInteger(input.maxDurationSeconds) ||
      input.maxDurationSeconds < 3600 ||
      input.maxDurationSeconds > 180 * 86400 ||
      (input.validForSeconds !== undefined &&
        (!Number.isSafeInteger(input.validForSeconds) ||
          input.validForSeconds < 60 ||
          input.validForSeconds > 900))
    )
      throw new Error("Invalid policy settings.");
    const data = record(value);
    const collectionSlug = slug(data.collection);
    if (collectionSlug !== slug(input.collectionSlug))
      throw new OpenSeaPolicyError("provider_collection_mismatch");
    const contract = getAddress(marketplaceChains[input.chain].contractAddress);
    const contracts = array(
      data.contracts,
      (item) => {
        const row = record(item);
        return { chain: string(row.chain), address: address(row.address) };
      },
      100
    );
    if (
      contracts.filter(
        (item) => item.chain === input.chain && item.address === contract
      ).length !== 1
    )
      throw new OpenSeaPolicyError("provider_collection_mismatch");
    if (boolean(data.is_disabled))
      throw new OpenSeaPolicyError("provider_collection_disabled");
    const pricing = record(data.pricing_currencies);
    const listingCurrency = payment(pricing.listing_currency, input.chain);
    const offerCurrency = payment(pricing.offer_currency, input.chain);
    if (offerCurrency !== getAddress(openseaCurrencies[input.chain].address))
      throw new Error("Unsupported offer currency.");
    const providerFees = array(
      data.fees,
      (item) => {
        const fee = record(item);
        return {
          recipient: address(fee.recipient),
          basisPoints: basisPoints(fee.fee),
          required: boolean(fee.required)
        };
      },
      31
    );
    // Resolve every fee, including optional rows, so malformed provider data
    // cannot silently become a zero-fee policy. Only required fees enter orders.
    for (const fee of providerFees) calculateOrderFees(10000n, [fee]);
    const fees = providerFees
      .filter((fee) => fee.required)
      .map(({ recipient, basisPoints }) => ({ recipient, basisPoints }));
    calculateOrderFees(10000n, fees);
    const requiredZone =
      data.required_zone === undefined ||
      data.required_zone === null ||
      data.required_zone === ""
        ? null
        : address(data.required_zone);
    if (
      requiredZone !== null &&
      ![zeroAddress, getAddress(openseaSignedZone)].includes(requiredZone)
    )
      throw new Error("Unsupported required zone.");
    const body = {
      schemaVersion: 1 as const,
      source: "opensea" as const,
      chain: input.chain,
      chainId: marketplaceChains[input.chain].chainId,
      collection: contract,
      // This is the provider's reported currency. Additional paths require
      // explicit per-collection acceptance evidence before being advertised.
      listingCurrencies: [listingCurrency],
      offerCurrency,
      listingZone: requiredZone ?? zeroAddress,
      offerZone: requiredZone ?? getAddress(openseaSignedZone),
      fees,
      maxDurationSeconds: String(input.maxDurationSeconds)
    };
    const policyVersion = `opensea-v1:${createHash("sha256")
      .update(
        JSON.stringify({ ...body, collectionSlug, feeSelection: "required" })
      )
      .digest("hex")}`;
    const wire = {
      ...body,
      policyVersion,
      expiresAt: String(
        Math.floor(input.observedAt / 1000) + (input.validForSeconds ?? 60)
      )
    };
    return {
      wire,
      policy: parseOpenSeaOrderPolicy(wire, input.chain),
      collectionSlug,
      providerFees
    };
  } catch (error) {
    if (error instanceof OpenSeaPolicyError) throw error;
    throw new OpenSeaPolicyError("provider_policy_unsupported");
  }
}

type Resolved = ReturnType<typeof resolveOpenSeaCollectionPolicy>;

export class OpenSeaPolicyResolver {
  private readonly pending = new Map<OpenSeaChain, Promise<Resolved>>();
  private readonly cache = new Map<
    OpenSeaChain,
    { at: number; value: Resolved }
  >();
  constructor(
    private readonly client: Pick<
      OpenSeaClient,
      "getRegisteredContract" | "getCollection"
    >,
    private readonly options: { maxDurationSeconds: number; timeoutMs?: number }
  ) {
    if (
      !Number.isSafeInteger(options.maxDurationSeconds) ||
      options.maxDurationSeconds < 3600 ||
      options.maxDurationSeconds > 180 * 86400 ||
      (options.timeoutMs !== undefined &&
        (!Number.isSafeInteger(options.timeoutMs) ||
          options.timeoutMs < 1 ||
          options.timeoutMs > 10000))
    )
      throw new Error("Invalid OpenSea policy resolver settings.");
  }

  async resolve(chain: OpenSeaChain, fresh = false) {
    if (!isOpenSeaChain(chain))
      throw new OpenSeaPolicyError("provider_collection_mismatch");
    const cached = this.cache.get(chain);
    if (
      !fresh &&
      cached &&
      Date.now() >= cached.at &&
      Date.now() - cached.at < 20000
    )
      return structuredClone(cached.value);
    let work = this.pending.get(chain);
    if (!work) {
      work = this.fetch(chain);
      this.pending.set(chain, work);
    }
    try {
      return structuredClone(await work);
    } finally {
      if (this.pending.get(chain) === work) this.pending.delete(chain);
    }
  }

  private async fetch(chain: OpenSeaChain) {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 10000
    );
    try {
      const collectionSlug = resolveOpenSeaContract(
        await this.client.getRegisteredContract(chain, controller.signal),
        chain
      );
      const raw = await this.client.getCollection(
        collectionSlug,
        controller.signal
      );
      if (controller.signal.aborted) throw new OpenSeaError("provider_timeout");
      const value = resolveOpenSeaCollectionPolicy(raw, {
        chain,
        collectionSlug,
        observedAt: started,
        maxDurationSeconds: this.options.maxDurationSeconds
      });
      this.cache.set(chain, { at: started, value });
      return value;
    } catch (error) {
      this.cache.delete(chain);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
