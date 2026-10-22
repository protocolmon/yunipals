import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { islandsAbi } from "../abi.js";
import { islandCollection } from "../constants.js";
import { pool } from "../offchain/db.js";
import { physicalPonderSchemaName } from "../offchain/sql.js";
import { fetchMetadata } from "../metadata/fetch.js";
import { safeErrorMessage } from "../safe-error.js";
import { islandMetadataHosts, islandMetadataUri } from "./metadata.js";
import {
  dueIslandJobs,
  publishIslandMetadata,
  retryIslandMetadata
} from "./publication.js";

function integerSetting(
  name: string,
  fallback: number,
  min: number,
  max: number
) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${name}`);
  return value;
}

const rpc = process.env.PONDER_RPC_URL_1;
if (!rpc) throw new Error("PONDER_RPC_URL_1 is required");
const client = createPublicClient({
  chain: mainnet,
  transport: http(rpc, { timeout: 15_000, retryCount: 1 })
});
const concurrency = integerSetting("ISLANDS_METADATA_CONCURRENCY", 8, 1, 16);
const auditSeconds = integerSetting(
  "ISLANDS_METADATA_AUDIT_SECONDS",
  3_600,
  60,
  604_800
);
const maxBytes = integerSetting(
  "ISLANDS_METADATA_MAX_BYTES",
  1_048_576,
  1_024,
  5_242_880
);
let stopping = false;
const abort = new AbortController();
const stop = () => {
  stopping = true;
  abort.abort();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

const lock = await pool.connect();
lock.on("error", stop);
try {
  if ((await client.getChainId()) !== islandCollection.chainId)
    throw new Error("islands_rpc_chain_mismatch");
  const acquired = (
    await lock.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('yunipals:islands-metadata')) AS acquired"
    )
  ).rows[0]?.acquired;
  if (!acquired) throw new Error("Another Islands metadata worker is running");
  while (!stopping) {
    try {
      const block = await client.getBlock({ blockTag: "finalized" });
      if (block.number === null || !block.hash)
        throw new Error("finalized_block_unavailable");
      const [genesisLimit, metadataStorage] = await Promise.all([
        client.readContract({
          address: islandCollection.address,
          abi: islandsAbi,
          functionName: "genesisLimit",
          blockNumber: block.number
        }),
        client.readContract({
          address: islandCollection.address,
          abi: islandsAbi,
          functionName: "metadataStorage",
          blockNumber: block.number
        })
      ]);
      const jobs = await dueIslandJobs(
        pool,
        physicalPonderSchemaName,
        block.number
      );
      // Shared fallback documents are fetched once per batch. This cache expires
      // every batch so a change at the same URI creates a new immutable revision.
      const documents = new Map<string, ReturnType<typeof fetchMetadata>>();
      for (
        let offset = 0;
        offset < jobs.length && !stopping;
        offset += concurrency
      ) {
        const results = await Promise.allSettled(
          jobs.slice(offset, offset + concurrency).map(async (job) => {
            try {
              const uri = islandMetadataUri(
                await client.readContract({
                  address: islandCollection.address,
                  abi: islandsAbi,
                  functionName: "tokenURI",
                  args: [BigInt(job.tokenId)],
                  blockNumber: block.number
                })
              );
              let document = documents.get(uri);
              if (!document) {
                document = fetchMetadata(uri, {
                  maxBytes,
                  allowedHosts: islandMetadataHosts
                });
                documents.set(uri, document);
              }
              const fetched = await document;
              await publishIslandMetadata(
                pool,
                physicalPonderSchemaName,
                job,
                {
                  uri,
                  blockNumber: block.number!,
                  blockHash: block.hash!,
                  metadataStorage: metadataStorage.toLowerCase(),
                  genesisLimit
                },
                fetched.document,
                auditSeconds
              );
            } catch (error) {
              await retryIslandMetadata(
                pool,
                physicalPonderSchemaName,
                job,
                block.number!,
                error
              );
            }
          })
        );
        for (const result of results)
          if (result.status === "rejected") {
            console.error(
              "Islands metadata job deferred",
              safeErrorMessage(result.reason)
            );
          }
      }
      if (jobs.length)
        console.log(
          `Islands metadata checked ${jobs.length} tokens at block ${block.number}`
        );
    } catch (error) {
      console.error("Islands metadata scan deferred", safeErrorMessage(error));
    }
    if (!stopping)
      await delay(5_000, undefined, { signal: abort.signal }).catch(
        () => undefined
      );
  }
} finally {
  await lock
    .query("SELECT pg_advisory_unlock(hashtext('yunipals:islands-metadata'))")
    .catch(() => undefined);
  lock.release();
  await pool.end();
}
