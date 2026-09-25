import type { Address } from "viem";

export const seaportDeployment = {
  address: "0x0000000000000068F116a894984e2DB1123eB395" as Address,
  name: "Seaport",
  version: "1.6"
} as const;

// Official BNB Chain WBNB deployment. Other offer currencies are added only
// after verifying each chain and its order provider's supported currencies.
export const bnbOfferCurrency = {
  address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  symbol: "WBNB",
  decimals: 18
} as const;

// Deployment configuration is not a trading-enable flag. The backend must
// advertise verified chain/action capabilities before the UI enables trading.
export const marketplaceChains = {
  ethereum: {
    chainId: 1,
    contractAddress: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
    source: "opensea",
    collectionSlug: "yunipals",
    nativeSymbol: "ETH"
  },
  base: {
    chainId: 8453,
    contractAddress: "0x98433df878e8c898cb907345c3a7756e5f72240f",
    source: "opensea",
    collectionSlug: "yunipals-base",
    nativeSymbol: "ETH"
  },
  polygon: {
    chainId: 137,
    contractAddress: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
    source: "opensea",
    collectionSlug: "yunipals-polygon",
    nativeSymbol: "POL"
  },
  bnb: {
    chainId: 56,
    contractAddress: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
    source: "yunipals",
    collectionSlug: null,
    nativeSymbol: "BNB"
  }
} as const satisfies Record<
  string,
  {
    chainId: number;
    contractAddress: Address;
    source: "opensea" | "yunipals";
    collectionSlug: string | null;
    nativeSymbol: string;
  }
>;

export type MarketplaceChain = keyof typeof marketplaceChains;

export function marketplaceAssetKey(asset: {
  chainId: number;
  contractAddress: Address;
  tokenId: string;
}) {
  if (!Number.isSafeInteger(asset.chainId) || asset.chainId <= 0) {
    throw new Error("Invalid asset chain ID.");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(asset.contractAddress)) {
    throw new Error("Invalid asset contract address.");
  }
  if (!/^(0|[1-9][0-9]*)$/.test(asset.tokenId)) {
    throw new Error("Token ID must be a canonical unsigned integer.");
  }
  if (BigInt(asset.tokenId) >= 2n ** 256n) {
    throw new Error("Token ID exceeds uint256.");
  }
  return `${asset.chainId}:${asset.contractAddress.toLowerCase()}:${asset.tokenId}`;
}
