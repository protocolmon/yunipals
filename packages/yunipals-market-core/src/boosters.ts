import type { Address, Hex } from "viem";

export const boosterIdentity = (collection: string, tokenId: string | bigint) =>
  `8453:${collection.toLowerCase()}:${tokenId}`;

export type BoosterType = {
  id: string;
  packTypeId: string;
  registry: Address;
  engine: Address;
  paymentToken: Address;
  price: string;
  intervalSeconds: string;
  mintsPerInterval: number;
  totalVariants: string;
  maxBatch: number;
  catalogHash: Hex;
  ruleHash: Hex;
  manifestUri: string;
  metadataBaseUri: string;
  salesPaused: boolean;
  openings: string;
};

export type BoosterOriginal = {
  id: string;
  collection: Address;
  tokenId: string;
  typeKey: string;
  engine: Address;
  owner: Address;
  revealedAt: string | null;
  dailyCommitted: string;
  minted: string;
  remaining: string;
  pendingRequest: string | null;
  burned: boolean;
  pack: BoosterType;
};

export type BoosterMonster = {
  id: string;
  collection: Address;
  tokenId: string;
  originalKey: string;
  requestKey: string;
  typeKey: string;
  owner: Address;
  mintedTo: Address;
  variantId: string;
  monsterType: string;
  color: string;
  horn: string;
  glitter: string;
  isOriginal: boolean;
  burned: boolean;
  mintBlock: string;
  metadataUri: string;
};

export type BoosterRecentOpening = {
  requestKey: string;
  requestId: string;
  engine: Address;
  opening: boolean;
  quantity: number;
  revealedAt: string;
  monster: BoosterMonster;
};

export type BoosterRequest = {
  id: string;
  engine: Address;
  wrapper: Address;
  requestId: string;
  originalKey: string;
  payer: Address;
  quantity: number;
  opening: boolean;
  paid: string;
  ruleHash: Hex;
  callbackGas: number;
  status: "pending" | "seeded" | "completed" | "forfeited";
  seed: string | null;
  requestedAt: string;
  receivedAt: string | null;
  transactionHash: Hex;
  recipient: Address | null;
};

export type BoosterSnapshot = {
  chainId: 8453;
  collection: Address | null;
  engine: Address | null;
  enabled: boolean;
  requestsPaused: boolean;
  indexedBlock: string | null;
  indexedBlockHash: Hex | null;
  indexedTimestamp: string | null;
};

export function accruedBoosterCredits(original: BoosterOriginal, now: bigint) {
  if (
    original.burned ||
    original.revealedAt === null ||
    BigInt(original.minted) === 0n
  )
    return { claimable: 0n, nextAt: null };
  const interval = BigInt(original.pack.intervalSeconds);
  if (interval <= 0n) return { claimable: 0n, nextAt: null };
  const reveal = BigInt(original.revealedAt);
  const elapsed = now > reveal ? now - reveal : 0n;
  const periods = elapsed / interval;
  const max = BigInt(original.pack.totalVariants) - 1n;
  const earned = periods * BigInt(original.pack.mintsPerInterval);
  const capped = earned > max ? max : earned;
  const available = capped - BigInt(original.dailyCommitted);
  return {
    claimable: available > 0n ? available : 0n,
    nextAt: earned >= max ? null : reveal + (periods + 1n) * interval
  };
}

export function boosterBatchSize(
  original: BoosterOriginal,
  now: bigint
): number {
  if (original.pendingRequest !== null || original.burned) return 0;
  const { claimable } = accruedBoosterCredits(original, now);
  return Number(
    claimable < BigInt(original.pack.maxBatch)
      ? claimable
      : BigInt(original.pack.maxBatch)
  );
}
