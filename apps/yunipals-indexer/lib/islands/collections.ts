import { islandCollection } from "../constants.js";

export const baseIslandCollection = {
  slug: "base-islands",
  chain: "base",
  chainId: 8453,
  address: "0x1058f1a6fedcaec94e488d6ec3c639e541faf066",
  deploymentBlock: 49_650_128,
  name: "Grassland Archipelago",
  genesisLimit: 1_000,
  origin: "airdrop",
  metadataMode: "fixed",
  schemaName: "yunipals_base_islands_v1"
} as const;

export const ethereumIslandCollection = {
  ...islandCollection,
  origin: "original",
  metadataMode: "storage"
} as const;

export const islandCollections = {
  "ethereum-islands": ethereumIslandCollection,
  "base-islands": baseIslandCollection
} as const;
export type IslandCollectionId = keyof typeof islandCollections;
export type IslandCollection = (typeof islandCollections)[IslandCollectionId];

export const baseIslandRuntimeSha256 =
  "8d2c974b8266116fdd1391dd6ede92f1130a9922adc60d81bfc3302233d644f4";
export const airdropSnapshotSha256 =
  "1c22d608123555d9bdf63d99cf8c77e481d00c195c017e20da55d9f03a02448e";
export const airdropDistributionSha256 =
  "315ecead989a95686a7c41fcdeac9b9ed2e1f586b5e7fae8806a37e8662a0282";
export const airdropSnapshotBlock = 25_694_139n;
export const airdropSnapshotBlockHash =
  "0x7d1947e957b1c7ddc734682913b9d31f15ce5a80856a2a4ca163b870aa431109";

export function fixedIslandUri(tokenId: string) {
  return `https://meta.polychainmonsters.com/v1/island-meta/grassland/${BigInt(tokenId) <= 1000n ? "10000000" : "20000000"}`;
}
