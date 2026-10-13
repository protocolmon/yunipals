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
export type IslandCollectionId = "ethereum-islands" | "base-islands";
export type IslandOrigin = "all" | "original" | "airdrop";
const apiPath = "/v2/islands";
export function islandOriginLabel(token: Pick<IslandToken, "collectionId">) {
  return token.collectionId === "base-islands"
    ? "Airdropped · Base"
    : "Original · Ethereum";
}
export function islandExplorerOrigin(
  collectionId: IslandCollectionId
): IslandOrigin {
  return collectionId === "base-islands" ? "airdrop" : "original";
}

export type IslandEdition = "Genesis" | "Personal";
export type IslandsFilters = {
  origin?: IslandOrigin;
  tokenId?: string;
  holding?: "all" | "wallet" | "staked";
  edition?: IslandEdition;
  owner?: EvmAddress;
  sort: "token-id-asc" | "token-id-desc";
};

export type IslandToken = {
  collectionId: IslandCollectionId;
  chain: "ethereum" | "base";
  chainId: 1 | 8453;
  origin: "original" | "airdrop";
  counterpart: {
    collectionId: IslandCollectionId;
    chain: "ethereum" | "base";
    chainId: 1 | 8453;
    contractAddress: EvmAddress;
    tokenId: string;
    href: string;
  } | null;
  airdrop: {
    snapshotBlock: string;
    snapshotBlockHash: string;
    snapshotSha256: string;
    sourceOwner: EvmAddress;
    recipient: EvmAddress;
    mintTransactionHash: string;
    mintBlock: string;
  } | null;
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
  originals?: number;
  airdropped?: number;
  complete?: boolean;
  unavailableCollections?: IslandCollectionId[];
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
  unavailableCollections?: IslandCollectionId[];
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
  indexingStatus?: {
    indexedBlock?: string | null;
    finalizedBlock?: string | null;
  };
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
  const origin = params.get("origin") || "all";
  if (!["all", "original", "airdrop"].includes(origin))
    throw new Error("Choose Original, Airdropped, or All islands.");
  const tokenId = params.get("tokenId");
  if (tokenId !== null && normalizeIslandTokenId(tokenId) !== tokenId)
    throw new Error("Enter a valid island token ID.");
  const owner = params.get("owner")?.trim();
  const sort = params.get("sort") || "token-id-asc";
  const holding = params.get("holding") || "all";
  if (!["all", "wallet", "staked"].includes(holding))
    throw new Error("Choose a valid island holding filter.");
  if (edition && edition !== "Genesis" && edition !== "Personal") {
    throw new Error("Choose either Genesis or Personal islands.");
  }
  if (owner && !isIslandOwner(owner)) {
    throw new Error("Enter a valid wallet address.");
  }
  if (sort !== "token-id-asc" && sort !== "token-id-desc") {
    throw new Error("Choose a valid token ID sort order.");
  }
  return {
    origin: origin as IslandOrigin,
    tokenId: tokenId ?? undefined,
    edition: edition ? (edition as IslandEdition) : undefined,
    owner: owner ? (owner.toLowerCase() as EvmAddress) : undefined,
    sort,
    holding: holding as IslandsFilters["holding"]
  };
}

export function islandOwnerHref(
  owner: EvmAddress,
  collectionId?: IslandCollectionId
) {
  return `${islandsCollectionHref}&owner=${owner}${collectionId ? `&origin=${islandExplorerOrigin(collectionId)}` : ""}`;
}

export function islandDetailHref(
  tokenId: string,
  collectionId: IslandCollectionId = islandsCollectionId
) {
  return `/collection/${collectionId}/${tokenId}`;
}

export function islandsTokensPath(filters: IslandsFilters, cursor?: string) {
  const params = new URLSearchParams({
    limit: "24",
    sort: filters.sort,
    origin: filters.origin ?? "all"
  });
  if (filters.tokenId) params.set("tokenId", filters.tokenId);
  if (filters.edition) params.set("edition", filters.edition);
  if (filters.owner) params.set("owner", filters.owner);
  if (
    environment.islandStakingEnabled &&
    (filters.owner || filters.holding === "staked")
  )
    params.set("holding", filters.holding ?? "all");
  if (cursor) params.set("cursor", cursor);
  return `${apiPath}/tokens?${params}`;
}

export function fetchIslandsStats(
  signal?: AbortSignal,
  origin: IslandOrigin = "all"
) {
  return fetchIndexerJson<IslandsStats>(
    `${apiPath}/stats?origin=${origin}`,
    signal
  );
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

export function fetchIsland(
  tokenId: string,
  signal?: AbortSignal,
  collectionId: IslandCollectionId = islandsCollectionId
) {
  return fetchIndexerJson<IslandDetail>(
    `/v2/collections/${collectionId}/tokens/${tokenId}`,
    signal
  );
}

export function fetchIslandTransfers(
  tokenId: string,
  cursor?: string,
  signal?: AbortSignal,
  collectionId: IslandCollectionId = islandsCollectionId
) {
  const params = new URLSearchParams({ limit: "25" });
  if (cursor) params.set("cursor", cursor);
  return fetchIndexerJson<IslandPage<IslandTransfer>>(
    `/v2/collections/${collectionId}/tokens/${tokenId}/transfers?${params}`,
    signal
  );
}
