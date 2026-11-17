import { parseAbi } from "viem";
import { yunipalMonstersAbiE8145098 } from "./boosterSourceAbi.e8145098.js";

// Preserve the historical ingestion ABI while indexing immutable card facts.
// Both ingestion and evidence readers must use this exact source definition.
export const yunipalMonstersAbiCardFacts = [
  ...yunipalMonstersAbiE8145098,
  ...parseAbi([
    "event CardFactsRecorded(uint256 indexed tokenId, uint32 sequence, uint64 mintedAt, bool imported)"
  ])
] as const;
