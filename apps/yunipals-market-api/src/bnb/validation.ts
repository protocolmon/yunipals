import { createPublicClient, http } from "viem";
import {
  bnbOfferCurrency,
  marketplaceChains
} from "@protopals/yunipals-market-core/registry";
import type { BnbPolicy } from "@/bnb/orders";

// Explicitly isolated fixture policy. Production creator policy is a separate
// launch gate and must never inherit this validation default.
export const bnbValidationPolicy: BnbPolicy = {
  version: "local-fork-validation-zero-fees-v1",
  rules: {
    collection: marketplaceChains.bnb.contractAddress,
    offerCurrency: bnbOfferCurrency.address,
    fees: [],
    maxDurationSeconds: 86400n
  }
};

export async function createBnbValidationClient(rpcUrl: string) {
  const client = createPublicClient({
    transport: http(rpcUrl, { timeout: 2000, retryCount: 0 }),
    cacheTime: 0
  });
  // Validation mode is usable only with a real, local BNB Anvil fork. It does
  // not enable public-chain admission. The separate explicit local-trading flag
  // exposes the complete browser flow only after these startup checks succeed.
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "anvil_metadata",
      params: []
    }),
    signal: AbortSignal.timeout(2000)
  });
  const metadata = (await response.json()) as {
    result?: { forkedNetwork?: { chainId?: number } };
  };
  if (
    !response.ok ||
    metadata.result?.forkedNetwork?.chainId !== 56 ||
    (await client.getChainId()) !== 56
  )
    throw new Error("BNB validation requires a local Anvil fork of chain 56.");
  return client;
}
