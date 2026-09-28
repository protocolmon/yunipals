export const collections = {
  ethereum: {
    slug: "ethereum",
    chainId: 1,
    ensCoinType: 60,
    address: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
    deploymentBlock: 12_134_519
  },
  base: {
    slug: "base",
    chainId: 8_453,
    ensCoinType: 2_147_492_101,
    address: "0x98433df878e8c898cb907345c3a7756e5f72240f",
    deploymentBlock: 22_224_075
  },
  polygon: {
    slug: "polygon",
    chainId: 137,
    ensCoinType: 2_147_483_785,
    address: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
    deploymentBlock: 21_814_218
  },
  bnb: {
    slug: "bnb",
    chainId: 56,
    ensCoinType: 2_147_483_704,
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
