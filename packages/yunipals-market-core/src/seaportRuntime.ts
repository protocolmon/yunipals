// Per-chain Seaport 1.6 runtime fingerprints retained by the existing market
// admission checks. Constructor immutables make these hashes chain-specific.
export const seaportRuntimeHashes = {
  1: "0x74499ac0cce14428e4b41541d5e44f28f5a6882a1051d0118867c2a93cd5aec0",
  56: "0x16bd146d392a011a996f447b813623d4857ba2d7621af38194a009cbc03ab5f4",
  137: "0x24fd52b9fba5545dabf736449aa4f2beed9562a4a641d2f6c85ca05eeed35d52",
  8453: "0x2d5cb8553e21a19550413299c05a6493cc606fb0000b5042328a5ba06bfdaf35"
} as const;
