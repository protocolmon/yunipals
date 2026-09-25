import { createPublicClient, keccak256, type PublicClient } from "viem";
import {
  marketplaceChains,
  seaportDeployment,
  type MarketplaceChain
} from "@protopals/yunipals-market-core/registry";

import { readBnbHead, seaportCodeHash } from "@/bnb/protocol";
import { createMeasuredOpenSeaReadRpc } from "@/opensea/readRpc";
import type { RpcComputeBudget } from "@/opensea/rpcComputeBudget";
import { assertOpenSeaRuntimeCode, readOpenSeaHead } from "@/opensea/chain";
import { isProductionRpcBudgetProxyUrl } from "@/rpcBudgetProxyRegistry";

export type LiveRpc = ReturnType<typeof createMeasuredOpenSeaReadRpc>;

function publicClient(rpc: LiveRpc) {
  return createPublicClient({
    transport: rpc.transport,
    cacheTime: 0
  }) as PublicClient;
}

async function assertLiveChain(client: PublicClient, chain: MarketplaceChain) {
  const head =
    chain === "bnb"
      ? await readBnbHead(client, Date.now, "finalized")
      : await readOpenSeaHead(client, chain, Date.now, "finalized");
  if ((await client.getChainId()) !== marketplaceChains[chain].chainId)
    throw new Error("Trading RPC returned the wrong chain.");
  const [seaportCode, collectionCode] = await Promise.all([
    client.getCode({
      address: seaportDeployment.address,
      blockNumber: head.number
    }),
    client.getCode({
      address: marketplaceChains[chain].contractAddress,
      blockNumber: head.number
    })
  ]);
  if (!collectionCode || collectionCode === "0x")
    throw new Error("Trading RPC returned no collection deployment.");
  if (chain === "bnb") {
    if (!seaportCode || keccak256(seaportCode) !== seaportCodeHash)
      throw new Error("Trading RPC returned the wrong Seaport deployment.");
  } else assertOpenSeaRuntimeCode(chain, seaportCode);
}

/**
 * Probe both providers independently before constructing the bounded failover
 * transport. This prevents a configured but unusable secondary from satisfying
 * production startup. Neither URLs nor provider errors reach logs or reports.
 */
export async function createLivePublicClient(
  chain: MarketplaceChain,
  rpcUrls: readonly [string, ...string[]],
  budget?: RpcComputeBudget
) {
  const productionProxy =
    rpcUrls.length === 1 && isProductionRpcBudgetProxyUrl(rpcUrls[0]!, chain);
  if (rpcUrls.length !== 2 && !productionProxy)
    throw new Error(
      "Production chain clients require the production RPC proxy or two providers."
    );
  for (const url of rpcUrls) {
    const probe = createMeasuredOpenSeaReadRpc(
      url,
      productionProxy ? 12000 : 6000,
      30000,
      budget
    );
    await assertLiveChain(publicClient(probe), chain).catch(() => {
      throw new Error(`The ${chain} RPC readiness probe failed.`);
    });
  }
  const rpc = createMeasuredOpenSeaReadRpc(
    rpcUrls,
    productionProxy ? 12000 : 6000,
    30000,
    budget
  );
  const client = publicClient(rpc);
  await assertLiveChain(client, chain);
  return { client, rpc };
}
