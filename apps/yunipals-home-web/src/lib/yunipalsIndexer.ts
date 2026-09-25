import {
  indexedChains,
  isIndexedChain,
  type IndexedChain,
  type TokenSort,
  type TokenMetadataFilter
} from "@protopals/yunipals-market-core/collectionTypes";
import { environment } from "@/environment";

export {
  indexedChains,
  isIndexedChain,
  tokenSorts,
  type IndexedChain,
  type TokenSort,
  type TokenMetadataFilter
} from "@protopals/yunipals-market-core/collectionTypes";

export const indexedCollectionCacheVersion = "multi-chain-v1";

export type EvmAddress = `0x${string}`;

export type ResolvedOwnerAddresses = Partial<Record<IndexedChain, EvmAddress>>;

export type OwnerResolution = {
  ownerInput?: string;
  ownerName?: string | null;
  resolvedAddresses?: ResolvedOwnerAddresses;
};

export const leaderboardMetrics = [
  "collector-score",
  "total-rarity",
  "monster-count",
  "unique-types",
  "special-count",
  "glitter-count"
] as const;

export type LeaderboardMetric = (typeof leaderboardMetrics)[number];

export type TokenAttribute = {
  trait_type: string;
  value: unknown;
  display_type?: string;
  [key: string]: unknown;
};

export type YunipalToken = {
  chain: IndexedChain;
  chainId: number;
  contractAddress: EvmAddress;
  tokenId: string;
  owner: EvmAddress;
  burned: boolean;
  lifecycle: number;
  mintBlock: string;
  lastTransferBlock: string;
  name: string | null;
  image: string | null;
  attributes: TokenAttribute[] | null;
  tokenUri: string | null;
  uriProvenance?: string;
  uriAuditStatus?: string;
  metadataAvailable?: boolean;
  hidden?: boolean;
  rarityPoints: string | null;
  rarityPointsCapped: string | null;
  [key: string]: unknown;
};

type ChainSelectionResponse = {
  chain: IndexedChain | null;
  chains: IndexedChain[];
};

export type TokenPage = OwnerResolution &
  ChainSelectionResponse & {
    items: YunipalToken[];
    nextCursor: string | null;
    total: number;
  };

export type OwnerTokenPage = Omit<TokenPage, "total"> & {
  owner: EvmAddress;
  visibility: TokenVisibility;
};

export type CategoricalTraitFacet = {
  traitType: string;
  kind: "categorical";
  values: Array<{
    value: string;
    count: number;
  }>;
};

export type NumericTraitFacet = {
  traitType: string;
  kind: "numeric";
  min: string;
  max: string;
};

export type TraitFacet = CategoricalTraitFacet | NumericTraitFacet;

export type TraitFacets = ChainSelectionResponse & {
  items: TraitFacet[];
  metadata: {
    available: number;
    missing: number;
  };
  updatedAt: string;
};

export type IndexedCollection = {
  slug: IndexedChain;
  chain: IndexedChain;
  chainId: number;
  ensCoinType: number;
  address: EvmAddress;
  deploymentBlock: number;
  knownTokens: number;
  activeSupply: number;
};

export type IndexedCollections = {
  items: IndexedCollection[];
};

export type Transfer = {
  id: string;
  token_id: string;
  lifecycle: number;
  from: string;
  to: string;
  block_number: string;
  block_timestamp: string;
  transaction_hash: string;
  transaction_index: number;
  log_index: number;
};

export type TokenDetailResponse = {
  token: YunipalToken;
  transfers: Transfer[];
  lifecycles: Record<string, unknown>[];
};

export function tokenKey(token: Pick<YunipalToken, "chain" | "tokenId">) {
  return `${token.chain}:${token.tokenId}`;
}

export type LeaderboardDefinition = {
  slug: LeaderboardMetric;
  label: string;
};

export type LeaderboardDefinitions = {
  items: LeaderboardDefinition[];
  collectorScore: {
    version: string;
    formula: string;
  };
  chain: IndexedChain | null;
  wallets: number;
  updatedAt: string | null;
};

export type LeaderboardEntry = {
  rank: number;
  owner: EvmAddress;
  ensName: string | null;
  score: string;
  monsterCount: number;
  totalRarity: string;
  uniqueTypes: number;
  specialCount: number;
  glitterCount: number;
  collectorScore: string;
  updatedAt: string;
};

export type LeaderboardPage = {
  metric: LeaderboardMetric;
  label: string;
  chain: IndexedChain | null;
  scoreVersion: string | null;
  items: LeaderboardEntry[];
  nextCursor: string | null;
  updatedAt: string | null;
};

export type OwnerLeaderboard = {
  owner: EvmAddress;
  ensName: string | null;
  ownerInput: string;
  ownerName: string | null;
  resolvedAddresses: ResolvedOwnerAddresses;
  monsterCount: number;
  totalRarity: string;
  uniqueTypes: number;
  specialCount: number;
  glitterCount: number;
  collectorScore: string;
  scoreVersion: string;
  updatedAt: string;
  totalRarityRank: number;
  monsterCountRank: number;
  uniqueTypesRank: number;
  specialCountRank: number;
  glitterCountRank: number;
  collectorScoreRank: number;
};

export type TokenQuery = {
  chain?: IndexedChain;
  chains?: readonly IndexedChain[];
  limit?: number;
  cursor?: string;
  owner?: string;
  burned?: boolean;
  traits?: Array<{
    traitType: string;
    traitValue: string;
  }>;
  rarityMin?: string;
  rarityMax?: string;
  rarityCappedMin?: string;
  rarityCappedMax?: string;
  metadata?: TokenMetadataFilter;
  sort?: TokenSort;
};

export const tokenVisibilities = ["visible", "hidden", "all"] as const;

export type TokenVisibility = (typeof tokenVisibilities)[number];

export type OwnerTokenQuery = Pick<TokenQuery, "chain" | "limit" | "cursor"> & {
  visibility?: TokenVisibility;
};

export type TokenVisibilityMessage = {
  owner: EvmAddress;
  tokenId: string;
  lifecycle: string | number;
  ownershipTransactionHash: `0x${string}`;
  ownershipLogIndex: string | number;
  hidden: boolean;
  nonce: string | number;
  deadline: string | number;
};

export type TokenVisibilityTypedData = {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: EvmAddress;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: TokenVisibilityMessage;
};

export type TokenVisibilitySigningData = {
  typedData: TokenVisibilityTypedData;
};

export class IndexerError extends Error {
  status: number;
  code?: string;

  constructor(status: number, code?: string, message?: string) {
    super(message || `Yunipals indexer returned ${status}`);
    this.name = "IndexerError";
    this.status = status;
    this.code = code;
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const response = await fetch(`${environment.yunipalsIndexerUrl}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    let errorCode: string | undefined;
    let errorMessage: string | undefined;

    try {
      const details = (await response.json()) as {
        error?: unknown;
        message?: unknown;
      };
      errorCode = typeof details.error === "string" ? details.error : undefined;
      errorMessage =
        typeof details.message === "string" ? details.message : undefined;
    } catch {
      // Some upstream failures do not include a JSON response body.
    }

    throw new IndexerError(response.status, errorCode, errorMessage);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(path, { signal });
}

function queryString(
  values: Record<string, string | number | boolean | undefined>
) {
  const params = new URLSearchParams();

  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  });

  const value = params.toString();
  return value ? `?${value}` : "";
}

type ChainQuery = IndexedChain | readonly IndexedChain[] | undefined;

function appendChainParams(params: URLSearchParams, selection: ChainQuery) {
  const chains =
    typeof selection === "string" ? [selection] : (selection ?? []);
  chains.forEach((chain) => params.append("chain", chain));
}

function chainQueryString(selection: ChainQuery) {
  const params = new URLSearchParams();
  appendChainParams(params, selection);
  const value = params.toString();
  return value ? `?${value}` : "";
}

export function fetchCollections(signal?: AbortSignal) {
  return getJson<IndexedCollections>("/v1/collections", signal);
}

export function fetchTraitFacets(
  chains?: IndexedChain | readonly IndexedChain[],
  signal?: AbortSignal
) {
  return getJson<TraitFacets>(`/v1/traits${chainQueryString(chains)}`, signal);
}

export function fetchTokens(query: TokenQuery = {}, signal?: AbortSignal) {
  const params = new URLSearchParams();

  appendChainParams(
    params,
    query.chains && query.chains.length > 0 ? query.chains : query.chain
  );

  Object.entries({
    limit: query.limit,
    cursor: query.cursor,
    owner: query.owner,
    burned: query.burned,
    rarityMin: query.rarityMin,
    rarityMax: query.rarityMax,
    rarityCappedMin: query.rarityCappedMin,
    rarityCappedMax: query.rarityCappedMax,
    metadata: query.metadata,
    sort: query.sort
  }).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  });

  query.traits?.forEach(({ traitType, traitValue }) => {
    params.append("traitType", traitType);
    params.append("traitValue", traitValue);
  });

  const queryValue = params.toString();
  return getJson<TokenPage>(
    `/v1/tokens${queryValue ? `?${queryValue}` : ""}`,
    signal
  );
}

export function fetchOwnerTokens(
  address: string,
  query: OwnerTokenQuery = {},
  signal?: AbortSignal
) {
  return getJson<OwnerTokenPage>(
    `/v1/owners/${encodeURIComponent(address)}/tokens${queryString(query)}`,
    signal
  );
}

export function fetchTokenVisibilitySigningData(
  chain: IndexedChain,
  tokenId: string,
  hidden: boolean,
  signal?: AbortSignal
) {
  return getJson<TokenVisibilitySigningData>(
    `/v1/tokens/${encodeURIComponent(chain)}/${encodeURIComponent(tokenId)}/visibility/signing-data${queryString({ hidden })}`,
    signal
  );
}

export function updateTokenVisibility(
  chain: IndexedChain,
  tokenId: string,
  message: TokenVisibilityMessage,
  signature: `0x${string}`,
  signal?: AbortSignal
) {
  return requestJson<unknown>(
    `/v1/tokens/${encodeURIComponent(chain)}/${encodeURIComponent(tokenId)}/visibility`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature }),
      signal
    }
  );
}

export async function fetchToken(
  chain: IndexedChain,
  tokenId: string,
  signal?: AbortSignal
): Promise<TokenDetailResponse> {
  const response = await getJson<
    Omit<TokenDetailResponse, "token"> & {
      token: Record<string, unknown> & {
        token_id: string;
        owner: string;
        burned: boolean;
        lifecycle: number;
        name?: string | null;
        image?: string | null;
        attributes?: TokenAttribute[] | null;
      };
    }
  >(
    `/v1/tokens/${encodeURIComponent(chain)}/${encodeURIComponent(tokenId)}`,
    signal
  );

  const raw = response.token;
  const responseChain =
    typeof raw.chain === "string" && isIndexedChain(raw.chain)
      ? raw.chain
      : chain;
  const rawChainId = raw.chain_id ?? raw.chainId;
  const rawContractAddress = raw.contract_address ?? raw.contractAddress;
  const rawFetchStatus = raw.fetch_status ?? raw.fetchStatus;
  const rawMetadataAvailable =
    raw.metadata_available ??
    raw.metadataAvailable ??
    (typeof rawFetchStatus === "string"
      ? rawFetchStatus === "success"
      : undefined);
  const rawRarityPoints = raw.rarity_points ?? raw.rarityPoints;
  const rawRarityPointsCapped =
    raw.rarity_points_capped ?? raw.rarityPointsCapped;
  return {
    ...response,
    token: {
      ...raw,
      chain: responseChain,
      chainId: Number(rawChainId),
      contractAddress: (typeof rawContractAddress === "string"
        ? rawContractAddress
        : "0x") as EvmAddress,
      tokenId: raw.token_id,
      owner: raw.owner as EvmAddress,
      burned: raw.burned,
      lifecycle: raw.lifecycle,
      mintBlock: String(raw.mint_block ?? ""),
      lastTransferBlock: String(raw.last_transfer_block ?? ""),
      name: raw.name ?? null,
      image: raw.image ?? null,
      attributes: raw.attributes ?? null,
      tokenUri:
        typeof (raw.token_uri ?? raw.tokenUri) === "string"
          ? String(raw.token_uri ?? raw.tokenUri)
          : null,
      uriProvenance:
        typeof (raw.uri_provenance ?? raw.uriProvenance) === "string"
          ? String(raw.uri_provenance ?? raw.uriProvenance)
          : undefined,
      uriAuditStatus:
        typeof (raw.audit_status ?? raw.uriAuditStatus) === "string"
          ? String(raw.audit_status ?? raw.uriAuditStatus)
          : undefined,
      metadataAvailable:
        typeof rawMetadataAvailable === "boolean"
          ? rawMetadataAvailable
          : undefined,
      rarityPoints:
        typeof rawRarityPoints === "string" ||
        typeof rawRarityPoints === "number"
          ? String(rawRarityPoints)
          : null,
      rarityPointsCapped:
        typeof rawRarityPointsCapped === "string" ||
        typeof rawRarityPointsCapped === "number"
          ? String(rawRarityPointsCapped)
          : null,
      hidden: typeof raw.hidden === "boolean" ? raw.hidden : undefined
    }
  } satisfies TokenDetailResponse;
}

export function fetchLeaderboardDefinitions(
  chain?: IndexedChain,
  signal?: AbortSignal
) {
  return getJson<LeaderboardDefinitions>(
    `/v1/leaderboards${queryString({ chain })}`,
    signal
  );
}

export function fetchLeaderboard(
  metric: LeaderboardMetric,
  query: { chain?: IndexedChain; limit?: number; cursor?: string } = {},
  signal?: AbortSignal
) {
  return getJson<LeaderboardPage>(
    `/v1/leaderboards/${metric}${queryString(query)}`,
    signal
  );
}

export function fetchOwnerLeaderboard(
  owner: string,
  query: { chain?: IndexedChain } = {},
  signal?: AbortSignal
) {
  return getJson<OwnerLeaderboard>(
    `/v1/owners/${encodeURIComponent(owner)}/leaderboard${queryString(query)}`,
    signal
  );
}

export function getTokenAttribute(
  token: Pick<YunipalToken, "attributes">,
  traitType: string
) {
  return token.attributes?.find(
    (attribute) =>
      attribute.trait_type.toLowerCase() === traitType.toLowerCase()
  )?.value;
}

export function getDisplayedRarity(
  token: Pick<YunipalToken, "rarityPoints" | "rarityPointsCapped">
) {
  return token.rarityPointsCapped ?? token.rarityPoints;
}

export function hasRarityCap(
  token: Pick<YunipalToken, "rarityPoints" | "rarityPointsCapped">
) {
  return (
    token.rarityPoints !== null &&
    token.rarityPointsCapped !== null &&
    token.rarityPoints !== token.rarityPointsCapped
  );
}

export function isEthereumAddress(value: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

export function isOwnerInput(value: string) {
  const input = value.trim();
  return isEthereumAddress(input) || input.includes(".");
}
