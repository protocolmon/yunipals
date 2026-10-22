import { randomUUID } from "node:crypto";
import { statfs } from "node:fs/promises";
import { parseAbi } from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import { runwareCreditMicrousd } from "./capacity";
import { boundedBody } from "./mediaApi";
import { arenaRuntime } from "./runtime";
import { arenaNativeConfiguration } from "./nativeSource";

const key = process.env.RUNWARE_API_KEY,
  storage = process.env.ARENA_MEDIA_ROOT;
const allowance = Number(
  process.env.ARENA_OPENAI_CREDIT_BUDGET_MICROUSD ?? "0"
);
const expiresAt = Date.parse(process.env.ARENA_OPENAI_BUDGET_EXPIRES_AT ?? "");
if (
  !key ||
  !storage ||
  !Number.isSafeInteger(allowance) ||
  allowance < 0 ||
  !Number.isSafeInteger(expiresAt)
)
  throw new Error(
    "Capacity worker requires Runware access, storage and an explicit expiring referee allowance."
  );
const runtime = await arenaRuntime({
    native: arenaNativeConfiguration().mode === "unified"
  }),
  base = runtime.clients.get(8453)!;
let stopped = false;
process.once("SIGTERM", () => {
  stopped = true;
});
process.once("SIGINT", () => {
  stopped = true;
});
try {
  while (!stopped) {
    try {
      await runtime.service.ready();
      const taskUUID = randomUUID();
      // Account response also contains team/key metadata: never persist or log it.
      // Official API: https://runware.ai/docs/models-api/account-management
      const response = await fetch("https://api.runware.ai/v1", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify([
          { taskType: "accountManagement", taskUUID, operation: "getDetails" }
        ]),
        redirect: "error",
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error("Account availability check failed.");
      const runwareMicrousd = runwareCreditMicrousd(
        JSON.parse((await boundedBody(response, 1000000)).toString("utf8")),
        taskUUID
      );
      const [block, gasPrice] = await Promise.all([
        base.getBlock({ blockTag: "latest" }),
        base.getGasPrice()
      ]);
      if (Math.abs(Number(block.timestamp) * 1000 - Date.now()) > 120000)
        throw new Error("Base head is stale.");
      const address = runtime.config.deployment.contract;
      const [available, maximum, referee, operator, wrapper] =
        await base.multicall({
          blockNumber: block.number,
          allowFailure: false,
          contracts: [
            { address, abi: arenaAbi, functionName: "availableVrfFunds" },
            { address, abi: arenaAbi, functionName: "maxVrfCost" },
            { address, abi: arenaAbi, functionName: "referee" },
            { address, abi: arenaAbi, functionName: "lobbyOperator" },
            { address, abi: arenaAbi, functionName: "i_vrfV2PlusWrapper" }
          ]
        });
      const [quote, refereeGas, operatorGas, disk] = await Promise.all([
        base.readContract({
          address: wrapper,
          abi: parseAbi([
            "function estimateRequestPriceNative(uint32,uint32,uint256) view returns (uint256)"
          ]),
          functionName: "estimateRequestPriceNative",
          // eth_call does not supply tx.gasprice by default. Price with a 2x
          // current-gas buffer; the contract enforces its cap again at join.
          args: [120000, 1, gasPrice * 2n],
          blockNumber: block.number
        }),
        base.getBalance({ address: referee, blockNumber: block.number }),
        base.getBalance({ address: operator, blockNumber: block.number }),
        statfs(storage)
      ]);
      await runtime.capacity.save({
        runwareMicrousd,
        openaiBudgetMicrousd: allowance,
        openaiBudgetExpiresAt: expiresAt,
        vrfAvailableWei: available.toString(),
        vrfQuoteWei: quote.toString(),
        vrfMaxWei: maximum.toString(),
        refereeGasWei: refereeGas.toString(),
        operatorGasWei: operatorGas.toString(),
        diskFreeBytes: disk.bavail * disk.bsize
      });
      console.log("Arena operating-capacity snapshot refreshed.");
    } catch {
      // Invalidate immediately; do not continue signing admissions on a failed check.
      await runtime.pool.query(
        "DELETE FROM yunipals_arena.capacity WHERE deployment=$1",
        [runtime.config.deployment.id]
      );
      console.error(
        "Arena capacity is unavailable; new admissions are paused."
      );
    }
    // Five-minute health checks; short waits allow prompt graceful shutdown.
    for (let seconds = 0; seconds < 300 && !stopped; seconds += 5)
      await new Promise((resolve) => setTimeout(resolve, 5000));
  }
} finally {
  await runtime.close();
}
