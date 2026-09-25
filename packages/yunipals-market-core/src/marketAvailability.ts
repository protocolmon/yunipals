import type { MarketplaceChain } from "./registry";

export type MarketChainEvidence = "current" | "recovering" | "unavailable";
export type MarketDiscoveryCoverage = "complete" | "partial" | "unavailable";
export type MarketOrderEvidence = "verified" | "pending" | "unavailable";
export type MarketListingState =
  | "listed"
  | "unlisted"
  | "updating"
  | "unavailable";

export type MarketCoverage = {
  status: MarketDiscoveryCoverage;
  completedAt: string | null;
  revision: string | null;
};

export type MarketChainAvailability = {
  chain: MarketplaceChain;
  evidence: MarketChainEvidence;
  listings: MarketCoverage;
  offers: MarketCoverage;
};

export type MarketOrderAvailability = {
  evidence: MarketOrderEvidence;
  checkedAt: string | null;
  expiresAt: string | null;
  reason: string | null;
};
