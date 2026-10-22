import pg from "pg";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { createIndexerReader } from "../../../../packages/yunipals-indexer-server/src/readers.js";
import { collections } from "../constants.js";
import { baseRpcUrlOf } from "../rpc.js";
import type { BaseMetadataPointRpc } from "./unified-base.js";

export { baseMetadataIngestionMode } from "./base-mode.js";

export function baseMetadataPointRpc(
  env: NodeJS.ProcessEnv = process.env
): BaseMetadataPointRpc {
  const client = createPublicClient({
    chain: base,
    transport: http(baseRpcUrlOf(env), { timeout: 15000, retryCount: 0 })
  });
  return {
    chainId: () => client.getChainId(),
    blockHash: async (blockNumber) => {
      const hash = (await client.getBlock({ blockNumber })).hash;
      if (!hash) throw new Error("Base metadata block unavailable.");
      return hash.toLowerCase();
    },
    implementation: async (blockNumber) => {
      const value = await client.getStorageAt({
        address: collections.base.address,
        blockNumber,
        slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
      });
      if (!value || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value))
        throw new Error("Base metadata implementation unavailable.");
      return `0x${value.slice(-40).toLowerCase()}`;
    }
  };
}

export function unifiedBaseRuntime(env: NodeJS.ProcessEnv = process.env) {
  if (!env.UNIFIED_INDEXER_DATABASE_URL)
    throw new Error("Shared indexer read database is required.");
  const sourcePool = new pg.Pool({
    connectionString: env.UNIFIED_INDEXER_DATABASE_URL,
    max: 2,
    application_name: "base_metadata_unified_reader",
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 15000,
    lock_timeout: 2000
  });
  return {
    reader: () =>
      createIndexerReader(sourcePool, {
        releaseId: env.UNIFIED_INDEXER_RELEASE_ID
      }),
    rpc: baseMetadataPointRpc(env),
    close: () => sourcePool.end()
  };
}
