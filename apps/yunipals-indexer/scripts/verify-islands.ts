import { open, unlink, type FileHandle } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { islandsAbi } from "../lib/abi.js";
import { islandCollection } from "../lib/constants.js";
import { pool, closePool } from "../lib/offchain/db.js";
import { physicalPonderSchemaName } from "../lib/offchain/sql.js";
import { safeErrorMessage } from "../lib/safe-error.js";
import { verifyIslandsOwnership } from "../lib/islands/verify.js";

const { values } = parseArgs({
  options: {
    activate: { type: "boolean", default: false },
    output: { type: "string" }
  }
});
const rpc = process.env.PONDER_RPC_URL_1;
if (!rpc) throw new Error("PONDER_RPC_URL_1 is required");
const client = createPublicClient({
  chain: mainnet,
  transport: http(rpc, { timeout: 15_000, retryCount: 1 })
});
let output: FileHandle | undefined;
let completed = false;
try {
  // Reserve an output path before --activate can change readiness.
  if (values.output) output = await open(values.output, "wx", 0o600);
  if ((await client.getChainId()) !== islandCollection.chainId)
    throw new Error("islands_rpc_chain_mismatch");
  const report = await verifyIslandsOwnership(
    pool,
    physicalPonderSchemaName,
    {
      finalizedBlock: async () => {
        const block = await client.getBlock({ blockTag: "finalized" });
        if (block.number === null || !block.hash)
          throw new Error("finalized_block_unavailable");
        return { number: block.number, hash: block.hash };
      },
      blockHash: async (block) =>
        (await client.getBlock({ blockNumber: block })).hash!,
      totalSupply: (blockNumber) =>
        client.readContract({
          address: islandCollection.address,
          abi: islandsAbi,
          functionName: "totalSupply",
          blockNumber
        }),
      tokenIds: (offset, count, blockNumber) =>
        client.multicall({
          allowFailure: false,
          blockNumber,
          contracts: Array.from(
            { length: count },
            (_, index) =>
              ({
                address: islandCollection.address,
                abi: islandsAbi,
                functionName: "tokenByIndex",
                args: [BigInt(offset + index)]
              }) as const
          )
        }),
      owners: (ids, blockNumber) =>
        client.multicall({
          allowFailure: false,
          blockNumber,
          contracts: ids.map(
            (id) =>
              ({
                address: islandCollection.address,
                abi: islandsAbi,
                functionName: "ownerOf",
                args: [id]
              }) as const
          )
        })
    },
    values.activate
  );
  const json = JSON.stringify(report, null, 2) + "\n";
  if (output) await output.writeFile(json);
  completed = true;
  console.log(json);
} catch (error) {
  console.error(safeErrorMessage(error));
  process.exitCode = 1;
} finally {
  await output?.close();
  if (output && !completed) await unlink(values.output!).catch(() => undefined);
  await closePool();
}
