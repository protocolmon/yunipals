import { isAddress } from "viem";
import { environment } from "@/environment";

import {
  fetchIndexerJson,
  type EvmAddress,
  type TokenAttribute
} from "@/lib/yunipalsIndexer";

export const islandsCollectionId = "ethereum-islands";
export const islandsContractAddress =
  "0xa22e2f53ca787414dc0643c399f92234949e2305";
export const islandsCollectionHref = "/?collection=islands";
const apiPath = `/v2/collections/${islandsCollectionId}`;

export type IslandEdition = "Genesis" | "Personal";
export type IslandsFilters = {
  holding?: "all" | "wallet" | "staked";
  edition?: IslandEdition;
  owner?: EvmAddress;
  sort: "token-id-asc" | "token-id-desc";
};

export type IslandToken = {
  collectionId: typeof islandsCollectionId;
  chain: "ethereum";
  chainId: 1;
  contractAddress: EvmAddress;
  tokenId: string;
  edition: IslandEdition;
  owner: EvmAddress | null;
  burned: boolean;
  lifecycle: number;
  mintBlock: string;
  mintTimestamp: string;
  lastTransferBlock: string;
  lastTransferTimestamp: string;
  lastTransactionHash: string;
  metadata: {
    id: string;
    name: string;
    image?: string;
    description: string;
    attributes: TokenAttribute[];
  } | null;
  metadataStatus: "published" | "retry" | "pending";
  staking?: {
    status: "staked" | "unverified" | "none";
    staker: EvmAddress | null;
    contractAddress: EvmAddress;
    checkedBlock: string | null;
  } | null;
};

export type IslandsStats = {
  activeSupply: number;
  knownTokens: number;
  burnedTokens: number;
  holders: number;
  genesis: number;
  personal: number;
  metadataAvailable: number;
};

export type IslandTransfer = {
  id: string;
  from: EvmAddress;
  to: EvmAddress;
  blockNumber: string;
  blockTimestamp: string;
  transactionHash: string;
  lifecycle: number;
};

export type IslandPage<T> = {
  items: T[];
  nextCursor: string | null;
  total?: number;
  complete?: boolean;
  stakingStatus?: {
    enabled: boolean;
    ready: boolean;
    checkedBlock: string | null;
    reason: string | null;
  };
};

export type IslandDetail = {
  token: IslandToken;
  lifecycles: Array<{
    lifecycle: number;
    mintedTo: EvmAddress;
    mintBlock: string;
    mintTimestamp: string;
    mintTransactionHash: string;
    burnedAtBlock: string | null;
    burnedAtTimestamp: string | null;
    burnTransactionHash: string | null;
  }>;
};

export function normalizeIslandTokenId(value: string): string | null {
  const digits = value.trim().replace(/^#/, "");
  if (!/^\d{1,78}$/.test(digits)) return null;
  const id = BigInt(digits);
  return id < 2n ** 256n ? id.toString() : null;
}

export function isIslandOwner(value: string): value is EvmAddress {
  return isAddress(value, { strict: false }) && !/^0x0{40}$/i.test(value);
}

export function parseIslandsFilters(params: URLSearchParams): IslandsFilters {
  const edition = params.get("edition");
  const owner = params.get("owner")?.trim();
  const sort = params.get("sort") || "token-id-asc";
  const holding = params.get("holding") || "all";
  if (!["all", "wallet", "staked"].includes(holding))
    throw new Error("Choose a valid island holding filter.");
  if (edition && edition !== "Genesis" && edition !== "Personal") {
    throw new Error("Choose either Genesis or Personal islands.");
  }
  if (owner && !isIslandOwner(owner)) {
    throw new Error("Enter a valid Ethereum wallet address.");
  }
  if (sort !== "token-id-asc" && sort !== "token-id-desc") {
    throw new Error("Choose a valid token ID sort order.");
  }
  return {
    edition: edition ? (edition as IslandEdition) : undefined,
    owner: owner ? (owner.toLowerCase() as EvmAddress) : undefined,
    sort,
    holding: holding as IslandsFilters["holding"]
  };
}

export function islandOwnerHref(owner: EvmAddress) {
  return `${islandsCollectionHref}&owner=${owner}`;
}

export function islandDetailHref(tokenId: string) {
  return `/collection/${islandsCollectionId}/${tokenId}`;
}

export function islandsTokensPath(filters: IslandsFilters, cursor?: string) {
  const params = new URLSearchParams({ limit: "24", sort: filters.sort });
  if (filters.edition) params.set("edition", filters.edition);
  if (filters.owner) {
    params.set("owner", filters.owner);
    if (environment.islandStakingEnabled)
      params.set("holding", filters.holding ?? "all");
  }
  if (cursor) params.set("cursor", cursor);
  return `${apiPath}/tokens?${params}`;
}

export function fetchIslandsStats(signal?: AbortSignal) {
  return fetchIndexerJson<IslandsStats>(`${apiPath}/stats`, signal);
}

export function fetchIslands(
  filters: IslandsFilters,
  cursor?: string,
  signal?: AbortSignal
) {
  return fetchIndexerJson<IslandPage<IslandToken>>(
    islandsTokensPath(filters, cursor),
    signal
  );
}

export function fetchIsland(tokenId: string, signal?: AbortSignal) {
  return fetchIndexerJson<IslandDetail>(`${apiPath}/tokens/${tokenId}`, signal);
}

export function fetchIslandTransfers(
  tokenId: string,
  cursor?: string,
  signal?: AbortSignal
) {
  const params = new URLSearchParams({ limit: "25" });
  if (cursor) params.set("cursor", cursor);
  return fetchIndexerJson<IslandPage<IslandTransfer>>(
    `${apiPath}/tokens/${tokenId}/transfers?${params}`,
    signal
  );
}
