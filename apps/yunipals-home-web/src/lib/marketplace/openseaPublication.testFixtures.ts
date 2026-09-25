import { zeroAddress, type Address } from "viem";

import {
  testFeeRecipient,
  testSeller
} from "@/lib/marketplace/marketplace.testFixtures";
import { parseOpenSeaOrderPolicy } from "@/lib/marketplace/openseaOrderPolicy";
import { createOpenSeaPublicationIntent } from "@/lib/marketplace/openseaPublication";
import {
  openseaCurrencies,
  openseaSignedZone,
  type OpenSeaChain
} from "@/lib/marketplace/openseaRegistry";
import { marketplaceChains } from "@/lib/marketplace/registry";

export function openSeaPublicationFixture({
  chain = "ethereum",
  side = "listing",
  currency,
  maker = testSeller,
  tokenId = "123",
  timestamp = 100n,
  counter = 0n,
  salt = 123n,
  grossAmount = 10n ** 18n
}: {
  chain?: OpenSeaChain;
  side?: "listing" | "offer";
  currency?: Address;
  maker?: Address;
  tokenId?: string;
  timestamp?: bigint;
  counter?: bigint;
  salt?: bigint;
  grossAmount?: bigint;
} = {}) {
  const asset = {
    chain,
    chainId: marketplaceChains[chain].chainId,
    contractAddress: marketplaceChains[chain].contractAddress,
    tokenId
  };
  const rawPolicy = {
    schemaVersion: 1,
    source: "opensea",
    chain,
    chainId: asset.chainId,
    collection: asset.contractAddress,
    policyVersion: "test-opensea-policy-v1",
    listingCurrencies: [
      chain === "polygon" ? openseaCurrencies[chain].address : zeroAddress,
      chain === "polygon" ? zeroAddress : openseaCurrencies[chain].address
    ],
    offerCurrency: openseaCurrencies[chain].address,
    listingZone: zeroAddress,
    offerZone: openseaSignedZone,
    maxDurationSeconds: "604800",
    expiresAt: (timestamp + 100n).toString(),
    fees: [{ recipient: testFeeRecipient, basisPoints: 250 }]
  };
  const policy = parseOpenSeaOrderPolicy(rawPolicy, chain);
  const draft = {
    asset,
    lifecycle: 2,
    maker,
    side,
    grossAmount,
    endTime: timestamp + 3600n,
    currency:
      currency ??
      (side === "offer" ? policy.offerCurrency : policy.listingCurrencies[0])
  };
  const intent = createOpenSeaPublicationIntent(
    draft,
    policy,
    { timestamp, counter },
    salt
  );
  return { intent, policy, rawPolicy, draft };
}
