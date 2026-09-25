import { createPublicClient, http } from "viem";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import type { Environment } from "@/environment";
import { OpenSeaClient } from "@/opensea/client";
import { OpenSeaPolicyResolver } from "@/opensea/policy";

export async function createOpenSeaValidation(environment: Environment) {
  const config = environment.openseaValidation;
  if (environment.deployment !== "staging" || !config)
    throw new Error("Explicit OpenSea validation configuration is required.");
  const client = createPublicClient({
    transport: http(config.rpcUrl, { timeout: 2000, retryCount: 0 }),
    cacheTime: 0
  });
  const response = await fetch(config.rpcUrl, {
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
  const chainId = marketplaceChains[config.chain].chainId;
  if (
    !response.ok ||
    metadata.result?.forkedNetwork?.chainId !== chainId ||
    (await client.getChainId()) !== chainId
  )
    throw new Error(
      "OpenSea validation requires a local Anvil fork of the selected chain."
    );
  // This client can only reach a local fixture provider and carries a fixed,
  // nonsecret fixture credential. Publication is disabled by default.
  const provider = new OpenSeaClient({
    apiKey: "yunipals-fixture-only",
    fixtureOrigin: config.providerOrigin
  });
  return {
    provider,
    clients: { [config.chain]: client },
    policies: new OpenSeaPolicyResolver(provider, {
      maxDurationSeconds: 86400
    }),
    options: { confirmations: 20n, indexerMaxAgeMs: 60000 }
  };
}
