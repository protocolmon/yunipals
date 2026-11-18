import {
  encodeFunctionData,
  parseAbi,
  type Address,
  type PublicClient
} from "viem";
import { estimateL1Fee } from "viem/op-stack";
import {
  boosterPacksAbi,
  packRegistryAbi
} from "@protopals/yunipals-market-core/boosterAbi";
import {
  boosterBatchSize,
  type BoosterOriginal
} from "@protopals/yunipals-market-core/boosters";

export const dailyClaimManyAbi = parseAbi([
  "function MAX_CLAIM_ORIGINALS() view returns(uint32)",
  "function claimMany(uint256[] originalIds,uint32[] quantities,uint256 maxTotalVrfPrice,uint256 deadline) payable returns(uint256[] requestIds)"
]);

export type DailyClaim = { original: BoosterOriginal; quantity: number };
export type DailyDeployment = {
  engine: Address;
  monsters: Address;
  registry: Address;
};

export function dailyClaimPlan(
  originals: BoosterOriginal[],
  account: string,
  deployment: DailyDeployment,
  now: bigint
): DailyClaim[] {
  const seen = new Set<string>();
  return originals.flatMap((original) => {
    if (
      original.owner.toLowerCase() !== account.toLowerCase() ||
      original.collection.toLowerCase() !== deployment.monsters.toLowerCase() ||
      original.engine.toLowerCase() !== deployment.engine.toLowerCase() ||
      seen.has(original.tokenId)
    )
      return [];
    seen.add(original.tokenId);
    const quantity = Math.min(7, boosterBatchSize(original, now));
    return quantity > 0 ? [{ original, quantity }] : [];
  });
}

// Fetch every page before showing a total. A partial response must never be
// presented as all of the wallet's originals.
export async function allDailyOriginals(
  fetchPage: (
    cursor: string | null
  ) => Promise<{ items: BoosterOriginal[]; nextCursor?: string | null }>
) {
  const items: BoosterOriginal[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? null;
    if (cursor && seen.has(cursor))
      throw new Error("Could not load all your originals. Try again.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}

export async function quoteDailyClaims(
  client: PublicClient,
  account: Address,
  deployment: DailyDeployment,
  claims: DailyClaim[]
) {
  const expiresAt = Date.now() + 600_000;
  const [fees, block, nativeLimit] = await Promise.all([
    client.estimateFeesPerGas(),
    client.getBlock({ blockTag: "latest" }),
    client
      .readContract({
        address: deployment.engine,
        abi: dailyClaimManyAbi,
        functionName: "MAX_CLAIM_ORIGINALS"
      })
      .catch(() => 0)
  ]);
  const deadline = block.timestamp + 600n;
  const calls = [];
  // Bound RPC concurrency for large collections; simulate each claim as its
  // owner. Wallet batching preserves that sender, unlike a multicall contract.
  for (const claim of claims) {
    const packTypeId = BigInt(claim.original.pack.packTypeId);
    const [pack, available] = await Promise.all([
      client.readContract({
        address: deployment.registry,
        abi: packRegistryAbi,
        functionName: "getPack",
        args: [packTypeId]
      }),
      client.readContract({
        address: deployment.engine,
        abi: boosterPacksAbi,
        functionName: "claimable",
        args: [BigInt(claim.original.tokenId)]
      })
    ]);
    if (
      !pack.active ||
      pack.rules.engine.toLowerCase() !== deployment.engine.toLowerCase()
    )
      throw new Error(
        "One of these packs is unavailable. Refresh your daily cards."
      );
    const quantity = Math.min(
      claim.quantity,
      Number(available),
      pack.rules.maxBatch
    );
    if (quantity < 1) continue;
    const [vrfPrice] = await client.readContract({
      address: deployment.engine,
      abi: boosterPacksAbi,
      functionName: "quote",
      args: [packTypeId, quantity, fees.maxFeePerGas]
    });
    const value = vrfPrice + vrfPrice / 10n + 1n;
    const data = encodeFunctionData({
      abi: boosterPacksAbi,
      functionName: "claim",
      args: [BigInt(claim.original.tokenId), quantity, value, deadline]
    });
    const transaction = {
      account,
      to: deployment.engine,
      data,
      value,
      ...fees
    };
    await client.call(transaction);
    const gas = ((await client.estimateGas(transaction)) * 120n) / 100n;
    const networkFee =
      gas * fees.maxFeePerGas +
      (await estimateL1Fee(client, {
        ...transaction,
        gas,
        chain: client.chain
      }));
    calls.push({
      ...claim,
      quantity,
      to: deployment.engine,
      data,
      value,
      gas,
      vrfPrice,
      networkFee
    });
  }
  if (!calls.length)
    throw new Error(
      "No daily cards are ready to open. Pending cards must finish first."
    );
  const value = calls.reduce((total, call) => total + call.value, 0n);
  let networkFee = calls.reduce((total, call) => total + call.networkFee, 0n);
  const nativeTransactions = [];
  if (nativeLimit > 0 && nativeLimit <= 20) {
    for (let offset = 0; offset < calls.length; offset += nativeLimit) {
      const group = calls.slice(offset, offset + nativeLimit);
      const value = group.reduce((total, call) => total + call.value, 0n);
      const data = encodeFunctionData({
        abi: dailyClaimManyAbi,
        functionName: "claimMany",
        args: [
          group.map((call) => BigInt(call.original.tokenId)),
          group.map((call) => call.quantity),
          value,
          deadline
        ]
      });
      const transaction = {
        account,
        to: deployment.engine,
        data,
        value,
        ...fees
      };
      await client.call(transaction);
      const gas = ((await client.estimateGas(transaction)) * 120n) / 100n;
      const networkFee =
        gas * fees.maxFeePerGas +
        (await estimateL1Fee(client, {
          ...transaction,
          gas,
          chain: client.chain
        }));
      nativeTransactions.push({
        to: deployment.engine,
        data,
        value,
        gas,
        networkFee
      });
    }
    networkFee = nativeTransactions.reduce(
      (total, transaction) => total + transaction.networkFee,
      0n
    );
  }
  if ((await client.getBalance({ address: account })) < value + networkFee)
    throw new Error("You need more ETH for randomness and network fees.");
  return {
    calls,
    value,
    networkFee,
    fees,
    expiresAt,
    nativeTransactions,
    nativeLimit
  };
}
