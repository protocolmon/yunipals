export const indexedChains = {
  ethereum: { chainId: 1, ensCoinType: 60 },
  base: { chainId: 8_453, ensCoinType: 2_147_492_101 },
  polygon: { chainId: 137, ensCoinType: 2_147_483_785 },
  bnb: { chainId: 56, ensCoinType: 2_147_483_704 }
} as const;
export type IndexedChain = keyof typeof indexedChains;

export const collections = {
  ethereum: {
    slug: "ethereum",
    ...indexedChains.ethereum,
    address: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
    deploymentBlock: 12_134_519
  },
  base: {
    slug: "base",
    ...indexedChains.base,
    address: "0x98433df878e8c898cb907345c3a7756e5f72240f",
    deploymentBlock: 22_224_075
  },
  polygon: {
    slug: "polygon",
    ...indexedChains.polygon,
    address: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
    deploymentBlock: 21_814_218
  },
  bnb: {
    slug: "bnb",
    ...indexedChains.bnb,
    address: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
    deploymentBlock: 7_579_197
  }
} as const;

export type CollectionSlug = keyof typeof collections;
export const collectionSlugs = Object.keys(collections) as CollectionSlug[];
export const CHAIN_ID = collections.ethereum.chainId;
export const COLLECTION_ADDRESS = collections.ethereum.address;
export const DEPLOYMENT_BLOCK = collections.ethereum.deploymentBlock;
export const CONSTRUCTOR_BASE_URI = "https://meta.polkamon.com/meta?id=";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const DEFAULT_ADMIN_ROLE = `0x${"00".repeat(32)}` as const;

// Legacy collection IDs remain chain names for the v1 APIs. New collections
// have their own identity and share a network definition with existing ones.
export const islandCollection = {
  slug: "ethereum-islands",
  chain: "ethereum",
  ...indexedChains.ethereum,
  address: "0xa22e2f53ca787414dc0643c399f92234949e2305",
  deploymentBlock: 14_570_451,
  deploymentTransaction:
    "0x5d60ee3e3b46fa806eedfd560be277905c9d5057772dfe5c104b5ce18519897e",
  name: "Grassland Archipelago",
  openseaSlug: "yunipals-islands",
  genesisLimit: 1_000
} as const;

export const indexedCollections = {
  ethereum: { ...collections.ethereum, chain: "ethereum" },
  base: { ...collections.base, chain: "base" },
  polygon: { ...collections.polygon, chain: "polygon" },
  bnb: { ...collections.bnb, chain: "bnb" },
  "ethereum-islands": islandCollection
} as const;
export type CollectionId = keyof typeof indexedCollections;
