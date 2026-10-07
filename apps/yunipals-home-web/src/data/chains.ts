import {
  marketplaceChains,
  type MarketplaceChain
} from "@/lib/marketplace/registry";

export type ChainId = MarketplaceChain;

type ChainDetails = {
  chainId: number;
  label: string;
  contractAddress: `0x${string}`;
  explorerUrl: string;
  cardClassName: string;
  accentBarClassName: string;
  badgeClassName: string;
};

export const chainDetails = {
  ethereum: {
    chainId: marketplaceChains.ethereum.chainId,
    label: "Ethereum",
    contractAddress: marketplaceChains.ethereum.contractAddress,
    explorerUrl: "https://etherscan.io",
    cardClassName: "bg-panel-ethereum",
    accentBarClassName:
      "bg-gradient-to-r from-ethereum via-[#8d91ff] to-[#b9a8ff]",
    badgeClassName: "text-ethereum ring-ethereum/20"
  },
  polygon: {
    chainId: marketplaceChains.polygon.chainId,
    label: "Polygon",
    contractAddress: marketplaceChains.polygon.contractAddress,
    explorerUrl: "https://polygonscan.com",
    cardClassName: "bg-panel-polygon",
    accentBarClassName:
      "bg-gradient-to-r from-polygon via-[#9d65ee] to-[#c4a7ff]",
    badgeClassName: "text-polygon ring-polygon/20"
  },
  base: {
    chainId: marketplaceChains.base.chainId,
    label: "Base",
    contractAddress: marketplaceChains.base.contractAddress,
    explorerUrl: "https://basescan.org",
    cardClassName: "bg-panel-base",
    accentBarClassName: "bg-basechain",
    badgeClassName: "text-basechain ring-basechain/20"
  },
  bnb: {
    chainId: marketplaceChains.bnb.chainId,
    label: "BNB Chain",
    contractAddress: marketplaceChains.bnb.contractAddress,
    explorerUrl: "https://bscscan.com",
    cardClassName: "bg-panel-bnb",
    accentBarClassName:
      "bg-gradient-to-r from-bnbchain via-[#f8d33a] to-[#fff0a6]",
    badgeClassName: "text-bnbchain ring-bnbchain/25"
  }
} satisfies Record<ChainId, ChainDetails>;

export type DisplayChainId = ChainId | "solana";

export const collectionChainDetails = {
  ...chainDetails,
  solana: {
    label: "Solana",
    badgeClassName: "text-grape ring-grape/20"
  }
};
