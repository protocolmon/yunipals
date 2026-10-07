import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, erc721Abi, http } from "viem";
import { mainnet } from "viem/chains";
import { islandsAbi } from "../abi.js";
import { islandCollection } from "../constants.js";
import { pool } from "../offchain/db.js";
import { physicalPonderSchemaName } from "../offchain/sql.js";
import { safeErrorMessage } from "../safe-error.js";
import {
  islandStakingAbi,
  islandStakingAddress,
  syncIslandStaking,
  type StakingChainReader
} from "./staking.js";

const rpc = process.env.PONDER_RPC_URL_1;
if (!rpc) throw new Error("PONDER_RPC_URL_1 is required");
const client = createPublicClient({
  chain: mainnet,
  batch: { multicall: true },
  transport: http(rpc, { timeout: 15_000, retryCount: 1 })
});
const reader: StakingChainReader = {
  finalizedBlock: async () => {
    const block = await client.getBlock({ blockTag: "finalized" });
    if (BigInt(Math.floor(Date.now() / 1_000)) - block.timestamp > 1_800n)
      throw new Error("staking_rpc_is_stale");
    return { number: block.number, hash: block.hash };
  },
  blockHash: async (blockNumber) =>
    (await client.getBlock({ blockNumber })).hash,
  islandContract: (blockNumber) =>
    client.readContract({
      address: islandStakingAddress,
      abi: islandStakingAbi,
      functionName: "islandContract",
      blockNumber
    }),
  custodyBalance: (blockNumber) =>
    client.readContract({
      address: islandCollection.address,
      abi: erc721Abi,
      functionName: "balanceOf",
      args: [islandStakingAddress],
      blockNumber
    }),
  owners: (ids, blockNumber) =>
    client.multicall({
      contracts: ids.map((id) => ({
        address: islandCollection.address,
        abi: islandsAbi,
        functionName: "ownerOf" as const,
        args: [id] as const
      })),
      allowFailure: false,
      blockNumber
    }),
  stakedIslands: (wallet, blockNumber) =>
    client.readContract({
      address: islandStakingAddress,
      abi: islandStakingAbi,
      functionName: "stakedIslandsOf",
      args: [wallet],
      blockNumber
    })
};
const abort = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => abort.abort());
const lock = await pool.connect();
lock.on("error", () => abort.abort());
try {
  if ((await client.getChainId()) !== 1)
    throw new Error("staking_rpc_chain_mismatch");
  const locked = (
    await lock.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [`island-staking:${physicalPonderSchemaName}`]
    )
  ).rows[0]?.acquired;
  if (!locked) throw new Error("Another Islands staking worker is running");
  do {
    try {
      console.log(
        "Islands staking verified",
        await syncIslandStaking(pool, physicalPonderSchemaName, reader)
      );
    } catch (error) {
      await pool.query(
        "UPDATE metadata.island_staking_scan SET state='unavailable' WHERE schema_name=$1",
        [physicalPonderSchemaName]
      );
      console.error("Islands staking unavailable", safeErrorMessage(error));
      if (process.argv.includes("--once")) throw error;
    }
    if (process.argv.includes("--once")) break;
    await delay(300_000, undefined, { signal: abort.signal }).catch(
      () => undefined
    );
  } while (!abort.signal.aborted);
} catch (error) {
  console.error("Islands staking worker stopped", safeErrorMessage(error));
  process.exitCode = 1;
} finally {
  await lock
    .query("SELECT pg_advisory_unlock(hashtext($1))", [
      `island-staking:${physicalPonderSchemaName}`
    ])
    .catch(() => undefined);
  lock.release();
  await pool.end();
}
