import { createPublicClient, type Address, type Hex } from "viem";
import { baseRpcUrlOf, bnbRpcUrlOf, polygonRpcUrlOf } from "../rpc.js";
import { unifiedRpcHttpTransport } from "./rpc-preflight.js";

export type EvidenceBlock = {
  number: bigint;
  hash: string;
  parentHash: string;
  timestamp: bigint;
};

export type EvidenceRpc = {
  providerId: string;
  chainId(): Promise<number>;
  block(numberOrTag: bigint | "latest" | "finalized"): Promise<EvidenceBlock>;
  receipt(hash: string): Promise<unknown>;
  code(address: string, blockNumber: bigint): Promise<string>;
};

export function evidenceRpc(
  chainId: number,
  env: NodeJS.ProcessEnv = process.env
): EvidenceRpc {
  const urls: Record<number, () => string | undefined> = {
    1: () => env.PONDER_RPC_URL_1,
    56: () => bnbRpcUrlOf(env),
    137: () => polygonRpcUrlOf(env),
    8453: () => baseRpcUrlOf(env)
  };
  const url = urls[chainId]?.();
  if (!url) throw new Error("Missing shared indexer RPC configuration.");
  const client = createPublicClient({
    transport: unifiedRpcHttpTransport(url, chainId, "unified_evidence", env, {
      timeout: 15000,
      retryCount: 0
    })
  });
  return {
    // Store a nonsecret selector, never the URL, API key or raw RPC error.
    providerId: `configured-rpc-${chainId}`,
    chainId: () => client.getChainId(),
    block: async (numberOrTag) => {
      const block = await client.getBlock(
        typeof numberOrTag === "bigint"
          ? { blockNumber: numberOrTag }
          : { blockTag: numberOrTag }
      );
      if (block.number === null || block.hash === null)
        throw new Error("Pending block is not indexed evidence.");
      return {
        number: block.number,
        hash: block.hash.toLowerCase(),
        parentHash: block.parentHash.toLowerCase(),
        timestamp: block.timestamp
      };
    },
    receipt: (hash) =>
      client.request({
        method: "eth_getTransactionReceipt",
        params: [hash as Hex]
      }),
    code: async (address, blockNumber) =>
      (await client.getCode({ address: address as Address, blockNumber })) ??
      "0x"
  };
}
