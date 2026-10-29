import { randomUUID } from "node:crypto";
import { statfs } from "node:fs/promises";
import { parseAbi } from "viem";
import { arenaAbi } from "@protopals/yunipals-market-core/arenaAbi";
import { runwareCreditMicrousd } from "./capacity";
import { boundedBody } from "./mediaApi";
import { arenaRuntime } from "./runtime";
import { arenaNativeConfiguration } from "./nativeSource";
import { arenaOpenaiFundingMode } from "./funding";
import { measureOpenRouterCredit } from "./animeDirectorApi";
import {
  arenaMediaStorageBudget,
  ARENA_MEDIA_QUOTA_BYTES,
  ARENA_MEDIA_RESERVED_BYTES
} from "./storage";

const key = process.env.RUNWARE_API_KEY,
  directorKey = process.env.OPENROUTER_API_KEY,
  storage = process.env.ARENA_MEDIA_ROOT;
const fundingMode = arenaOpenaiFundingMode();
// Zeroed pilot fields mean "not used" in ongoing mode, not a provider balance.
// Per-battle reservations and usage remain recorded.
const allowance =
  fundingMode === "ongoing"
    ? 0
    : Number(process.env.ARENA_OPENAI_CREDIT_BUDGET_MICROUSD ?? "0");
const expiresAt =
  fundingMode === "ongoing"
    ? 0
    : Date.parse(process.env.ARENA_OPENAI_BUDGET_EXPIRES_AT ?? "");
if (
  (!key && process.env.ARENA_MEDIA_KIND !== "anime") ||
  (!directorKey && process.env.ARENA_MEDIA_KIND === "anime") ||
  !storage ||
  !Number.isSafeInteger(allowance) ||
  allowance < 0 ||
  !Number.isSafeInteger(expiresAt)
)
  throw new Error(
    "Capacity worker requires Runware access, storage and valid OpenAI funding configuration."
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
    let measuredSince: string | undefined;
    try {
      measuredSince = (
        await runtime.pool.query<{ measured_at: string }>(
          "SELECT clock_timestamp()::text AS measured_at"
        )
      ).rows[0]!.measured_at;
      await runtime.service.ready();
      const mediaStorage = await arenaMediaStorageBudget(
        storage,
        Number(process.env.ARENA_MEDIA_QUOTA_BYTES ?? ARENA_MEDIA_QUOTA_BYTES),
        Number(
          process.env.ARENA_MEDIA_RESERVED_BYTES ?? ARENA_MEDIA_RESERVED_BYTES
        )
      );
      const runwareMicrousd =
        runtime.config.mediaKind === "anime"
          ? 0
          : await (async () => {
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
                  {
                    taskType: "accountManagement",
                    taskUUID,
                    operation: "getDetails"
                  }
                ]),
                redirect: "error",
                signal: AbortSignal.timeout(20000)
              });
              if (!response.ok)
                throw new Error("Account availability check failed.");
              return runwareCreditMicrousd(
                JSON.parse(
                  (await boundedBody(response, 1000000)).toString("utf8")
                ),
                taskUUID
              );
            })();
      const openrouterMicrousd =
        runtime.config.mediaKind === "anime"
          ? await measureOpenRouterCredit(directorKey!)
          : undefined;
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
      await runtime.capacity.save(
        {
          runwareMicrousd,
          ...(openrouterMicrousd !== undefined ? { openrouterMicrousd } : {}),
          openaiFundingMode: fundingMode,
          openaiBudgetMicrousd: allowance,
          openaiBudgetExpiresAt: expiresAt,
          vrfAvailableWei: available.toString(),
          vrfQuoteWei: quote.toString(),
          vrfMaxWei: maximum.toString(),
          refereeGasWei: refereeGas.toString(),
          operatorGasWei: operatorGas.toString(),
          diskFreeBytes: disk.bavail * disk.bsize,
          ...mediaStorage
        },
        measuredSince
      );
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
    for (let seconds = 0; seconds < 300 && !stopped; seconds += 5) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (stopped) break;
      try {
        const published = await runtime.pool.query(
          "SELECT 1 FROM yunipals_arena.media_job WHERE deployment=$1 AND state='ready' AND updated_at>$2 LIMIT 1",
          [runtime.config.deployment.id, measuredSince]
        );
        if (published.rowCount) break;
      } catch {
        // Keep the regular backoff on a database outage; never add RPC retries.
      }
    }
  }
} finally {
  await runtime.pool.end();
}
