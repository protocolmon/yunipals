import { erc20Abi, zeroAddress, type Address, type PublicClient } from "viem";
import {
  portalGradingAbi,
  portalCompetitionAbi
} from "@protopals/yunipals-market-core/portalAbi";

export async function readCompetition(
  client: PublicClient,
  grading: Address,
  blockNumber: bigint
) {
  const address = await client.readContract({
    address: grading,
    abi: portalGradingAbi,
    functionName: "competition",
    blockNumber
  });
  if (address === zeroAddress) return null;
  const read = <
    T extends
      | "CONTRIBUTION"
      | "RULES_HASH"
      | "BATCH_SIZE"
      | "entryCount"
      | "batchCount"
      | "totalLiability"
      | "usdc"
      | "grading"
      | "pendingCount"
      | "admissionHash"
      | "admissionsOpen"
  >(
    functionName: T
  ) =>
    client.readContract({
      address,
      abi: portalCompetitionAbi,
      functionName,
      blockNumber
    });
  const [
    fee,
    rulesHash,
    batchSize,
    entryCount,
    batchCount,
    liability,
    usdc,
    source,
    pending,
    admissionHash,
    accepting
  ] = await Promise.all([
    read("CONTRIBUTION"),
    read("RULES_HASH"),
    read("BATCH_SIZE"),
    read("entryCount"),
    read("batchCount"),
    read("totalLiability"),
    read("usdc"),
    read("grading"),
    read("pendingCount"),
    read("admissionHash"),
    read("admissionsOpen")
  ]);
  if (source.toLowerCase() !== grading.toLowerCase())
    throw new Error("Competition grading source mismatch.");
  const reserves = await client.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
    blockNumber
  });
  if (reserves < liability)
    throw new Error("Competition reserves do not cover prizes.");
  const nextBatch = entryCount / batchSize + 1n;
  const theme = await client.readContract({
    address,
    abi: portalCompetitionAbi,
    functionName: "getTheme",
    args: [nextBatch],
    blockNumber
  });
  const previous =
    !accepting && nextBatch > 1n
      ? await client.readContract({
          address,
          abi: portalCompetitionAbi,
          functionName: "getBatch",
          args: [nextBatch - 1n],
          blockNumber
        })
      : null;
  return {
    address,
    fee,
    rulesHash,
    batchSize,
    entryCount,
    batchCount,
    liability,
    reserves,
    pending,
    nextBatch,
    admissionHash,
    accepting,
    theme,
    phase: accepting
      ? "open"
      : previous && BigInt(previous.completed) < batchSize
        ? "grading"
        : "theme"
  };
}

export async function readCompetitionBatch(
  client: PublicClient,
  address: Address,
  batchId: bigint,
  blockNumber: bigint
) {
  const [batch, batchSize, contribution] = await Promise.all([
    client.readContract({
      address,
      abi: portalCompetitionAbi,
      functionName: "getBatch",
      args: [batchId],
      blockNumber
    }),
    client.readContract({
      address,
      abi: portalCompetitionAbi,
      functionName: "BATCH_SIZE",
      blockNumber
    }),
    client.readContract({
      address,
      abi: portalCompetitionAbi,
      functionName: "CONTRIBUTION",
      blockNumber
    })
  ]);
  if (batch.funded === 0) throw new Error("Competition batch not found.");
  const leaders = await Promise.all(
    batch.leaders.map(async (entryId, rank) => {
      if (entryId === 0n) return null;
      const entry = await client.readContract({
        address,
        abi: portalCompetitionAbi,
        functionName: "getEntry",
        args: [entryId],
        blockNumber
      });
      const amount = await client.readContract({
        address,
        abi: portalCompetitionAbi,
        functionName: "prize",
        args: [rank],
        blockNumber
      });
      return {
        entryId,
        ...entry,
        amount,
        paid: batch.paid[rank],
        rank: rank + 1
      };
    })
  );
  return {
    id: batchId,
    theme: await client.readContract({
      address,
      abi: portalCompetitionAbi,
      functionName: "getTheme",
      args: [batchId],
      blockNumber
    }),
    rubric: batch.rubric,
    funded: batch.funded,
    completed: batch.completed,
    settled: batch.settled,
    ready:
      BigInt(batch.funded) === batchSize &&
      BigInt(batch.completed) === batchSize,
    pool: BigInt(batch.funded) * contribution,
    leaders
  };
}
