import { parseAbi, type Address, type PublicClient } from "viem";
import type { BoosterMonster } from "@protopals/yunipals-market-core/boosters";

const pickerAbi = parseAbi([
  "function matches(uint256 portalId, uint256 tokenId) view returns (bool)",
  "function pendingRequest(uint256 tokenId) view returns (uint256)",
  "function historyCount(uint256 tokenId) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)"
]);

type PortalCardContext = {
  cards: Address;
  grading: Address;
  portalId: string;
  owner: Address;
};

/** Use the contract's complete gate rules, including card facts and pack type. */
export async function eligiblePortalCards(
  client: Pick<PublicClient, "getBlockNumber" | "multicall">,
  context: PortalCardContext,
  cards: BoosterMonster[]
) {
  const candidates = cards.filter(
    (card) =>
      !card.burned &&
      card.collection.toLowerCase() === context.cards.toLowerCase() &&
      card.owner.toLowerCase() === context.owner.toLowerCase()
  );
  if (!candidates.length) return [];
  const blockNumber = await client.getBlockNumber();
  const checks: readonly { status: string; result?: unknown }[] =
    await client.multicall({
      blockNumber,
      allowFailure: true,
      contracts: candidates.flatMap((card) => [
        {
          address: context.grading,
          abi: pickerAbi,
          functionName: "matches",
          args: [BigInt(context.portalId), BigInt(card.tokenId)]
        },
        {
          address: context.grading,
          abi: pickerAbi,
          functionName: "pendingRequest",
          args: [BigInt(card.tokenId)]
        },
        {
          address: context.cards,
          abi: pickerAbi,
          functionName: "ownerOf",
          args: [BigInt(card.tokenId)]
        },
        {
          address: context.grading,
          abi: pickerAbi,
          functionName: "historyCount",
          args: [BigInt(card.tokenId)]
        }
      ])
    });
  // An unavailable check must never turn into an eligible card or an empty wallet.
  if (
    checks.length !== candidates.length * 4 ||
    checks.some((check) => check.status !== "success")
  )
    throw new Error("Could not check your cards. Please try again.");
  return candidates.filter((_, index) => {
    const [matches, pending, owner, version] = checks.slice(
      index * 4,
      index * 4 + 4
    );
    return (
      matches.result === true &&
      pending.result === 0n &&
      version.result === 0n &&
      typeof owner.result === "string" &&
      owner.result.toLowerCase() === context.owner.toLowerCase()
    );
  });
}
