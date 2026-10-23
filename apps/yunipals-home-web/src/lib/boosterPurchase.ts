import {
  encodeFunctionData,
  parseAbi,
  type Address,
  type PublicClient
} from "viem";
import { boosterPacksAbi } from "@protopals/yunipals-market-core/boosterAbi";

export const boosterPurchaseAbi = parseAbi([
  "function MAX_OPEN_PACKS() view returns (uint32)",
  "function quoteOpenPacks(uint256 packTypeId,uint32 count,uint256 gasPrice) view returns (uint256 totalVrfPrice,uint32 callbackGas)",
  "function openPacks(uint256 packTypeId,uint32 count,uint256 maxTotalVrfPrice,uint256 deadline) payable returns (uint256[] requestIds,uint256[] originalIds)"
]);
export const boosterPurchaseLimit = 10;
const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const singlePurchaseImplementation =
  "0x92e2351a83b6c445c94d0b887259d2b940c82a5a";

export function validateBoosterPurchaseQuantity(
  quantity = 1,
  limit = boosterPurchaseLimit
) {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > Math.min(limit, boosterPurchaseLimit)
  )
    throw new Error(`Choose between 1 and ${limit} packs.`);
  return quantity;
}

export async function readBoosterPurchaseLimit(
  client: Pick<PublicClient, "getStorageAt" | "readContract">,
  engine: Address
) {
  const implementation = await client.getStorageAt({
    address: engine,
    slot: implementationSlot
  });
  if (
    implementation?.toLowerCase() ===
    `0x${"0".repeat(24)}${singlePurchaseImplementation.slice(2)}`
  )
    return 1;
  // Only the known original implementation falls back to one. RPC errors or
  // unknown implementations must not masquerade as a successful capability read.
  const limit = await client.readContract({
    address: engine,
    abi: boosterPurchaseAbi,
    functionName: "MAX_OPEN_PACKS"
  });
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Pack quantities could not be checked. Please try again.");
  return Math.min(limit, boosterPurchaseLimit);
}

export function boosterPurchaseData(
  packTypeId: bigint,
  quantity: number,
  maxTotalVrfPrice: bigint,
  deadline: bigint
) {
  validateBoosterPurchaseQuantity(quantity);
  return quantity === 1
    ? encodeFunctionData({
        abi: boosterPacksAbi,
        functionName: "openPack",
        args: [packTypeId, maxTotalVrfPrice, deadline]
      })
    : encodeFunctionData({
        abi: boosterPurchaseAbi,
        functionName: "openPacks",
        args: [packTypeId, quantity, maxTotalVrfPrice, deadline]
      });
}
