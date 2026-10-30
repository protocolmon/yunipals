import type { PublicClient } from "viem";
import { arenaV2Abi } from "@protopals/yunipals-market-core/arenaV2Abi";
import { arenaMode } from "@protopals/yunipals-market-core/arenaProtocol";
import type { ArenaConfig } from "./arenaLive";

export async function readArenaJoinPayment(
  client: PublicClient,
  config: ArenaConfig,
  id: string
) {
  if (config.contractVersion !== 2)
    return { firstEntry: false, value: 0n, fees: undefined };
  if (
    config.randomnessFunding !== "first-entrant" ||
    !config.mediaKind ||
    !/^[1-9][0-9]*$/.test(id) ||
    BigInt(id) >= 2n ** 256n ||
    Number((BigInt(id) - 1n) % 2n) !== arenaMode(config.mediaKind)
  )
    throw new Error(
      "The battle mode or randomness funding configuration could not be verified."
    );
  const fees = await client.estimateFeesPerGas({
    type: "eip1559",
    chain: undefined
  });
  if (fees.maxFeePerGas <= 0n || fees.maxPriorityFeePerGas > fees.maxFeePerGas)
    throw new Error(
      "The current network fee could not be verified. Please try again."
    );
  const [firstEntry, value] = await client.readContract({
    address: config.contract,
    abi: arenaV2Abi,
    functionName: "quoteJoin",
    args: [BigInt(id), fees.maxFeePerGas]
  });
  if (value < 0n || (firstEntry ? value === 0n : value !== 0n))
    throw new Error(
      "The island draw quote could not be verified. Please refresh."
    );
  return { firstEntry, value, fees };
}
