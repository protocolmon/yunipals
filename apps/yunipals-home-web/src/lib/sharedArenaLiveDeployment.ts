import type { Hex } from "viem";

// Independently verified confirmed-v2 browser record. Keeping this transaction
// prevents a new browser/device from offering another deployment after cutover.
export const sharedArenaConfirmedHash: Hex | null =
  "0xb428cadf0ee49422852ece94a598781825b7d6d5d55782ba3ca6e02f77a09850";
