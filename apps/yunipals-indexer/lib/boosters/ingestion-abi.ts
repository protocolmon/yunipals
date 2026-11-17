// Preserve the historical ingestion ABI and add the immutable facts event.
// This changes the monster source identity and requires a new indexed release.
import { parseAbi } from "viem";
import { yunipalMonstersAbiE8145098 } from "../../../../packages/yunipals-market-core/src/boosterSourceAbi.e8145098.js";
export { packRegistryAbi } from "../../../../packages/yunipals-market-core/src/boosterAbi.js";
export { boosterPacksAbiE8145098 as boosterPacksAbi } from "../../../../packages/yunipals-market-core/src/boosterSourceAbi.e8145098.js";

export const yunipalMonstersAbi = [
  ...yunipalMonstersAbiE8145098,
  ...parseAbi([
    "event CardFactsRecorded(uint256 indexed tokenId, uint32 sequence, uint64 mintedAt, bool imported)"
  ])
] as const;
