import { getAddress, zeroAddress, type Address } from "viem";

import {
  openSeaCurrency,
  openseaCurrencies,
  openseaSignedZone,
  type OpenSeaChain
} from "./openseaRegistry";
import { calculateOrderFees, type OrderFeePolicy } from "./orderPolicy";
import { marketplaceChains } from "./registry";
import { address, array, decimal, integer, record, string } from "./validation";

export type OpenSeaOrderPolicy = {
  chain: OpenSeaChain;
  collection: Address;
  version: string;
  listingCurrencies: Address[];
  offerCurrency: Address;
  listingZone: Address;
  offerZone: Address;
  maxDurationSeconds: bigint;
  expiresAt: bigint;
  fees: OrderFeePolicy;
};

/** The server resolves required collection fees, currencies and requiredZone
 * from OpenSea. The client permits only explicitly implemented deployments. */
export function parseOpenSeaOrderPolicy(
  value: unknown,
  chain: OpenSeaChain
): OpenSeaOrderPolicy {
  const data = record(value);
  const collection = address(data.collection);
  if (
    data.schemaVersion !== 1 ||
    data.source !== "opensea" ||
    data.chain !== chain ||
    data.chainId !== marketplaceChains[chain].chainId ||
    getAddress(collection) !==
      getAddress(marketplaceChains[chain].contractAddress)
  )
    throw new Error("The OpenSea collection policy does not match this chain.");
  const listingCurrencies = array(data.listingCurrencies, address, 2);
  if (
    !listingCurrencies.length ||
    new Set(listingCurrencies).size !== listingCurrencies.length
  )
    throw new Error("Invalid listing currencies.");
  for (const currency of listingCurrencies) openSeaCurrency(chain, currency);
  const offerCurrency = address(data.offerCurrency);
  if (
    getAddress(offerCurrency) !== getAddress(openseaCurrencies[chain].address)
  )
    throw new Error("Unsupported OpenSea offer currency.");
  const listingZone = address(data.listingZone);
  const offerZone = address(data.offerZone);
  for (const zone of [listingZone, offerZone])
    if (
      ![zeroAddress, getAddress(openseaSignedZone)].includes(getAddress(zone))
    )
      throw new Error("This collection requires an unsupported order zone.");
  // Provider default offers use its signed zone. A deployment may advertise
  // an open offer only after its actual provider admission has been verified.
  const fees = array(
    data.fees,
    (value) => {
      const fee = record(value);
      return {
        recipient: address(fee.recipient),
        basisPoints: integer(fee.basisPoints, 9999)
      };
    },
    31
  );
  calculateOrderFees(10_000n, fees);
  const maxDurationSeconds = BigInt(decimal(data.maxDurationSeconds));
  if (maxDurationSeconds < 3600n || maxDurationSeconds > 180n * 86400n)
    throw new Error("Unsupported order expiry policy.");
  return {
    chain,
    collection,
    version: string(data.policyVersion, 128),
    listingCurrencies,
    offerCurrency,
    listingZone,
    offerZone,
    maxDurationSeconds,
    expiresAt: BigInt(decimal(data.expiresAt)),
    fees
  };
}

export function assertOpenSeaPolicyCurrent(
  policy: OpenSeaOrderPolicy,
  now: bigint
) {
  if (policy.expiresAt <= now || policy.expiresAt > now + 120n)
    throw new Error("The OpenSea fee policy expired. Review the order again.");
}
