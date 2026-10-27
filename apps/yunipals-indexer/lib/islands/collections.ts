import {
  islandCollection,
  baseIslandCollection as registeredBaseIslandCollection
} from "../constants.js";
import { ownershipReadConfig, unifiedOwnershipReads } from "../offchain/sql.js";

export const legacyBaseIslandCollection = {
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

export const baseIslandCollection = {
  ...legacyBaseIslandCollection,
  ...registeredBaseIslandCollection,
  metadataMode: "token",
  schemaName: "yunipals_base_islands_v2"
} as const;
export const baseIslandReadSchema = () =>
  unifiedOwnershipReads
    ? ownershipReadConfig.readSchema
    : baseIslandCollection.schemaName;
export const baseIslandMetadataUri =
  "https://islands-meta.yunipals.com/v2/base-islands/";
export const replacementSnapshotSha256 =
  "7a0af719a7f13ea8b94df6f64c1c1573657b412ddd5b39fa5651ddf973b9d2d7";
export const replacementSnapshotBlock = 52_587_044n;
export const replacementSnapshotBlockHash =
  "0x805301a21f019844c3d9fd37441d40a863f85c7b812c21491bc4f96a996fe97b";
export const replacementDistributionRoot =
  "0xd2aebf9b6ba24e175372e11a7d418d18ca5c357075ce9d225f64a5ea1836a011";
export const revealAssignmentsSha256 =
  "cfdc7ea0a31f1779e1ef5e2a6e00a1f262b411226022b318f797697dfbb3fc2e";
export function baseIslandUri(tokenId: string) {
  return baseIslandMetadataUri + tokenId;
}

export const ethereumIslandCollection = {
  ...islandCollection,
  origin: "original",
  metadataMode: "storage"
} as const;

export const islandCollections = {
  "ethereum-islands": ethereumIslandCollection,
  "base-islands-v2": baseIslandCollection
} as const;
export type IslandCollectionId = keyof typeof islandCollections;
export type IslandCollection = (typeof islandCollections)[IslandCollectionId];

export const baseIslandRuntimeSha256 =
  "c96de4530c373eede3c088ccb4f25b06efe7145ae8ffe69237f63f48bf935aad";
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
